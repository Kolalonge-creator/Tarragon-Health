-- Tarragon Health
-- Continuous, always-generated clinical note.
--
-- clinical_encounter_notes (20260827201621, wired into the timeline in
-- 20260827201654) already gives clinicians a properly-modeled, immutable-
-- once-signed, per-patient narrative note. The gap founder asked to close:
-- it is entirely opt-in -- a clinician has to remember to open "new note"
-- for it to exist at all, so a real interaction can go completely
-- undocumented if nobody does. This migration makes a DRAFT note a
-- guaranteed backend side-effect of a clinician-patient interaction
-- concluding, so the record always exists to review/sign rather than
-- depending on someone remembering to start one -- a continuous chart, not
-- an opt-in one.
--
-- Scope: the three interaction types with a structurally reliable clinician
-- attribution already established elsewhere in the schema --
--   * escalations.status -> 'resolved'   (assigned_doctor_id)
--   * async_consults.status -> 'answered' (answered_by, already a
--     clinical_staff.id, stamped by the existing private.stamp_async_
--     consult_answer BEFORE trigger)
--   * video_consultations.status -> 'completed' (private.video_consultation_
--     clinician(), the existing best-available resolver built for
--     consultation_feedback attribution -- 20260829093626)
-- care_messages and specialist_referrals are deliberately NOT included here:
-- a message reply is a conversation, not a clinical encounter, and a
-- referral's own documentation lives on the referral row itself
-- (referral_reason/treatment_plan_note) -- neither is the kind of encounter
-- §4.10's note model was built to describe. Widening scope further is a
-- product decision, not assumed here.
--
-- Attribution discipline: every one of the three source events above can be
-- concluded from a genuine live clinician session (auth.uid() resolves) OR
-- from a service-role/webhook context with no session at all (most
-- plausible for video_consultations, whose completion may be driven by a
-- Zoom webhook -- see private.video_consultation_clinician's own comment:
-- "video_consultations has no clinician column at all"). The existing
-- attribution trigger unconditionally required auth.uid() to resolve to an
-- active clinical-tier staff row, which would either wrongly attribute a
-- system-driven note to whichever session happens to be open, or -- worse,
-- since this fires inside the SAME transaction as the status update --
-- raise and roll back the triggering update entirely when no session
-- exists. Fixed by extending the INSERT branch with the SAME
-- transaction-local trusted-actor pattern already used for service-role
-- writes with a real known actor (private.audit_actor_id /
-- 20260812041044_service_role_write_actor_attribution.sql): a new GUC,
-- app.trusted_clinical_staff_author, settable only from inside the three
-- new SECURITY DEFINER trigger functions below (never exposed to
-- authenticated/anon), carrying an ALREADY-RESOLVED clinical_staff.id from
-- one of the three legitimate sources above -- never a guess, and always
-- re-verified (active, correct org, clinical tier) before being trusted.
-- auto_generated itself is server-derived by the same trigger from which
-- path resolved authorship, exactly like every other attribution column on
-- this table -- a client cannot claim a manually-typed note is
-- system-generated, or vice versa.
--
-- Never blocks the interaction it documents: each of the three new trigger
-- functions wraps its insert in its own exception handler. A resolvable
-- clinician is required or the attempt is silently skipped (no note is
-- better than a falsely-attributed one); any unexpected failure is logged
-- via a WARNING and swallowed, never raised, so an encounter-note bug can
-- never block a doctor from resolving an escalation, answering a consult,
-- or a video call from being marked complete.

alter table public.clinical_encounter_notes
  add column auto_generated boolean not null default false;

comment on column public.clinical_encounter_notes.auto_generated is
  'true when this draft was created automatically by the platform the moment the underlying interaction (escalation resolved / async consult answered / video consultation completed) concluded, rather than by a clinician opening "new note" themselves. Server-derived by private.enforce_clinical_encounter_note_attribution from which authorship path resolved the insert -- never client-supplied. Still authored by, and must still be reviewed and finalized by, a real clinician; this only guarantees the draft exists.';

create index clinical_encounter_notes_auto_pending_idx
  on public.clinical_encounter_notes (authored_by_staff, encounter_date desc)
  where auto_generated and status = 'draft';

comment on index public.clinical_encounter_notes_auto_pending_idx is
  'Backs "notes awaiting your review" worklists: a clinician''s own auto-generated drafts not yet signed off.';

-- ---------------------------------------------------------------------------
-- Attribution trigger: add the trusted-system-author path (INSERT only).
-- UPDATE branch is unchanged except for propagating auto_generated through.
-- ---------------------------------------------------------------------------

create or replace function private.enforce_clinical_encounter_note_attribution()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff_id uuid;
  v_trusted_staff_id uuid;
  v_via_trusted_system boolean := false;
begin
  if tg_op = 'INSERT' then
    v_trusted_staff_id := nullif(current_setting('app.trusted_clinical_staff_author', true), '')::uuid;

    if v_trusted_staff_id is not null then
      select id into v_staff_id
      from public.clinical_staff
      where id = v_trusted_staff_id
        and organisation_id = new.organisation_id
        and active
        and doctor_tier in ('medical_officer', 'senior_medical_officer', 'chief_medical_officer')
      limit 1;
      v_via_trusted_system := v_staff_id is not null;
    end if;

    if v_staff_id is null then
      select id into v_staff_id
      from public.clinical_staff
      where profile_id = (select auth.uid())
        and organisation_id = new.organisation_id
        and active
        and doctor_tier in ('medical_officer', 'senior_medical_officer', 'chief_medical_officer')
      limit 1;
      v_via_trusted_system := false;
    end if;

    if v_staff_id is null then
      raise exception 'Only a clinical-tier member of the care team can write or finalize a clinical encounter note.'
        using errcode = '42501';
    end if;

    new.authored_by_staff := v_staff_id;
    new.authored_by_profile := (select profile_id from public.clinical_staff where id = v_staff_id);
    new.auto_generated := v_via_trusted_system;
    new.status := 'draft';
    new.finalized_by_staff := null;
    new.finalized_at := null;
    new.identity_confirmed := false;
    new.identity_confirmed_by := null;
    new.identity_confirmed_at := null;
    return new;
  end if;

  select id into v_staff_id
  from public.clinical_staff
  where profile_id = (select auth.uid())
    and organisation_id = new.organisation_id
    and active
    and doctor_tier in ('medical_officer', 'senior_medical_officer', 'chief_medical_officer')
  limit 1;

  if v_staff_id is null then
    raise exception 'Only a clinical-tier member of the care team can write or finalize a clinical encounter note.'
      using errcode = '42501';
  end if;

  if old.status = 'finalized' then
    raise exception 'This encounter note is finalized and cannot be edited. Write a new note if something new needs recording.'
      using errcode = '42501';
  end if;

  new.authored_by_staff := old.authored_by_staff;
  new.authored_by_profile := old.authored_by_profile;
  new.auto_generated := old.auto_generated;

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

comment on function private.enforce_clinical_encounter_note_attribution() is
  'INSERT: resolves authorship either from a live clinician session (auth.uid()) or, when app.trusted_clinical_staff_author is set (only ever done by the three auto-draft trigger functions in 20260917030000_auto_generated_continuous_clinical_note.sql), from an already-established attribution -- re-verified active/org/tier before being trusted either way. auto_generated is set from which path resolved it, never client-supplied. UPDATE: blocks editing a finalized note, keeps authorship and auto_generated immutable, enforces identity confirmation before finalizing.';

-- ---------------------------------------------------------------------------
-- Auto-draft #1: escalation resolved.
-- ---------------------------------------------------------------------------

create or replace function private.auto_draft_note_from_escalation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff_id uuid;
begin
  if exists (
    select 1 from public.clinical_encounter_notes
    where escalation_id = new.id and auto_generated
  ) then
    return null;
  end if;

  if new.assigned_doctor_id is null then
    return null;
  end if;

  select id into v_staff_id
  from public.clinical_staff
  where profile_id = new.assigned_doctor_id
    and organisation_id = new.organisation_id
    and active
    and doctor_tier in ('medical_officer', 'senior_medical_officer', 'chief_medical_officer')
  limit 1;

  if v_staff_id is null then
    return null;
  end if;

  perform set_config('app.trusted_clinical_staff_author', v_staff_id::text, true);

  insert into public.clinical_encounter_notes (
    organisation_id, patient_id, escalation_id, encounter_type, reason_for_encounter
  ) values (
    new.organisation_id, new.patient_id, new.id, 'escalation_review',
    left(coalesce(nullif(btrim(new.reason), ''), 'Escalation review'), 500)
  );

  -- set_config(..., true) is transaction-local, not statement-local: left
  -- unset, this value would still be visible to (and wrongly trusted by)
  -- any later insert into clinical_encounter_notes within the SAME
  -- transaction/request -- confirmed by a sabotage test that a plain manual
  -- insert immediately afterward could otherwise inherit it and self-claim
  -- auto_generated=true. Clear it immediately, same idiom as
  -- app.care_team_handover_note (20260828182015).
  perform set_config('app.trusted_clinical_staff_author', '', true);

  return null;
exception
  when others then
    perform set_config('app.trusted_clinical_staff_author', '', true);
    raise warning 'auto_draft_note_from_escalation failed for escalation %: %', new.id, sqlerrm;
    return null;
end;
$$;

comment on function private.auto_draft_note_from_escalation() is
  'Guarantees a draft clinical_encounter_notes row the moment an escalation is resolved. Never raises: a resolution can never be blocked by a note-drafting failure.';

drop trigger if exists escalations_auto_draft_encounter_note on public.escalations;
create trigger escalations_auto_draft_encounter_note
  after update of status on public.escalations
  for each row
  when (new.status = 'resolved' and old.status is distinct from 'resolved')
  execute function private.auto_draft_note_from_escalation();

revoke all on function private.auto_draft_note_from_escalation() from public;

-- ---------------------------------------------------------------------------
-- Auto-draft #2: async consult answered.
-- ---------------------------------------------------------------------------

create or replace function private.auto_draft_note_from_async_consult()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff_id uuid;
begin
  if exists (
    select 1 from public.clinical_encounter_notes
    where async_consult_id = new.id and auto_generated
  ) then
    return null;
  end if;

  if new.answered_by is null then
    return null;
  end if;

  select id into v_staff_id
  from public.clinical_staff
  where id = new.answered_by
    and organisation_id = new.organisation_id
    and active
    and doctor_tier in ('medical_officer', 'senior_medical_officer', 'chief_medical_officer')
  limit 1;

  if v_staff_id is null then
    return null;
  end if;

  perform set_config('app.trusted_clinical_staff_author', v_staff_id::text, true);

  insert into public.clinical_encounter_notes (
    organisation_id, patient_id, async_consult_id, encounter_type, reason_for_encounter,
    assessment, plan
  ) values (
    new.organisation_id, new.patient_id, new.id, 'async_consult',
    left(coalesce(nullif(btrim(new.question), ''), 'Async consult'), 500),
    nullif(btrim(new.answer), ''), null
  );

  -- See auto_draft_note_from_escalation's comment: must clear immediately,
  -- not leave it to linger for the rest of the transaction.
  perform set_config('app.trusted_clinical_staff_author', '', true);

  return null;
exception
  when others then
    perform set_config('app.trusted_clinical_staff_author', '', true);
    raise warning 'auto_draft_note_from_async_consult failed for async_consult %: %', new.id, sqlerrm;
    return null;
end;
$$;

comment on function private.auto_draft_note_from_async_consult() is
  'Guarantees a draft clinical_encounter_notes row the moment an async consult is answered, pre-filled with the patient''s question and the clinician''s own answer text as a starting point. Never raises: an answer can never be blocked by a note-drafting failure.';

drop trigger if exists async_consults_auto_draft_encounter_note on public.async_consults;
create trigger async_consults_auto_draft_encounter_note
  after update of status on public.async_consults
  for each row
  when (new.status = 'answered' and old.status is distinct from 'answered')
  execute function private.auto_draft_note_from_async_consult();

revoke all on function private.auto_draft_note_from_async_consult() from public;

-- ---------------------------------------------------------------------------
-- Auto-draft #3: video consultation completed.
-- ---------------------------------------------------------------------------

create or replace function private.auto_draft_note_from_video_consultation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinician_profile uuid;
  v_staff_id uuid;
  v_reason text;
begin
  if exists (
    select 1 from public.clinical_encounter_notes
    where video_consultation_id = new.id and auto_generated
  ) then
    return null;
  end if;

  -- Best-available resolver, same one consultation_feedback attribution
  -- already relies on -- video_consultations itself has no clinician
  -- column. Returns null when genuinely unknown; skip rather than guess.
  v_clinician_profile := private.video_consultation_clinician(new.id);
  if v_clinician_profile is null then
    return null;
  end if;

  select id into v_staff_id
  from public.clinical_staff
  where profile_id = v_clinician_profile
    and organisation_id = new.organisation_id
    and active
    and doctor_tier in ('medical_officer', 'senior_medical_officer', 'chief_medical_officer')
  limit 1;

  if v_staff_id is null then
    return null;
  end if;

  v_reason := case new.context
    when 'pre_referral_triage' then 'Pre-referral triage video consultation'
    when 'specialist_consult' then 'Specialist video consultation'
    else 'Video consultation'
  end;

  perform set_config('app.trusted_clinical_staff_author', v_staff_id::text, true);

  insert into public.clinical_encounter_notes (
    organisation_id, patient_id, video_consultation_id, encounter_type,
    reason_for_encounter, call_started_at, call_ended_at
  ) values (
    new.organisation_id, new.patient_id, new.id, 'video_consult',
    v_reason, new.started_at, new.ended_at
  );

  -- See auto_draft_note_from_escalation's comment: must clear immediately,
  -- not leave it to linger for the rest of the transaction.
  perform set_config('app.trusted_clinical_staff_author', '', true);

  return null;
exception
  when others then
    perform set_config('app.trusted_clinical_staff_author', '', true);
    raise warning 'auto_draft_note_from_video_consultation failed for video_consultation %: %', new.id, sqlerrm;
    return null;
end;
$$;

comment on function private.auto_draft_note_from_video_consultation() is
  'Guarantees a draft clinical_encounter_notes row the moment a video consultation completes, when a clinician can be resolved via private.video_consultation_clinician(). Silently skipped when attribution is genuinely unknown -- see that function''s own comment -- rather than guessed. Never raises: a call completing (frequently a Zoom webhook with no clinician session) can never be blocked by a note-drafting failure.';

drop trigger if exists video_consultations_auto_draft_encounter_note on public.video_consultations;
create trigger video_consultations_auto_draft_encounter_note
  after update of status on public.video_consultations
  for each row
  when (new.status = 'completed' and old.status is distinct from 'completed')
  execute function private.auto_draft_note_from_video_consultation();

revoke all on function private.auto_draft_note_from_video_consultation() from public;

-- ---------------------------------------------------------------------------
-- Proof
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'clinical_encounter_notes' and column_name = 'auto_generated'
  ) then
    raise exception 'clinical_encounter_notes.auto_generated missing after migration';
  end if;

  if not exists (
    select 1 from pg_trigger where tgname = 'escalations_auto_draft_encounter_note' and not tgisinternal
  ) then
    raise exception 'escalations_auto_draft_encounter_note trigger missing';
  end if;
  if not exists (
    select 1 from pg_trigger where tgname = 'async_consults_auto_draft_encounter_note' and not tgisinternal
  ) then
    raise exception 'async_consults_auto_draft_encounter_note trigger missing';
  end if;
  if not exists (
    select 1 from pg_trigger where tgname = 'video_consultations_auto_draft_encounter_note' and not tgisinternal
  ) then
    raise exception 'video_consultations_auto_draft_encounter_note trigger missing';
  end if;

  -- Not asserting authenticated has no EXECUTE here: all three are trigger-
  -- returning functions, which Postgres refuses to invoke outside trigger
  -- context regardless of grant (same reasoning private schema's own
  -- default-privilege model already applies elsewhere -- see
  -- reference_private_schema_authenticated_default_is_intentional). The
  -- `revoke all ... from public` above still removes the default PUBLIC
  -- grant new functions would otherwise pick up.

  raise notice 'PASS: continuous clinical note auto-drafting wired for escalations, async_consults, video_consultations';
end $$;
