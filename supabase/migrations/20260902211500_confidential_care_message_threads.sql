-- Sexual & Reproductive Health platform, 8/8: confidential mode (spec §47.2,
-- §47.12 — "a family caregiver should not automatically receive: 'Your
-- spouse has an STI result.'").
--
-- RE-TIMESTAMPED 2026-09-02 (was 20260829090700): the previous reconciliation
-- pass (see the RECONCILED note below) rewrote this file's body to call the
-- 2-arg private.can_read_clinical(patient_id, 'messaging') added by
-- 20260830103251, but left the FILENAME at its original 2026-08-29 timestamp
-- -- which sorts BEFORE 20260830103251, so a fresh migration replay (CI, or
-- `supabase db reset`) hit "function private.can_read_clinical(uuid,
-- unknown) does not exist" at this file, before that function was ever
-- created. This migration was, at the time, already live on
-- koiplnmbgnqnbywhpjlf under version 20260902203618 (applied there correctly
-- AFTER 20260830103251 and 20260902010000, since it was ad-hoc applied after
-- both already existed) -- only the local file/filename was stale; the
-- schema_migrations ledger row for that version was updated in place to
-- 20260902211500 to match, rather than re-applying (the DDL is idempotent --
-- add column if not exists, drop+create policy, create-or-replace function --
-- but re-applying under yet another version would have added a third
-- drifted ledger row for the same migration instead of fixing the one that
-- existed). Also depends on 20260902010000 (fix_start_care_thread_self_access),
-- which re-creates a 6-arg start_care_thread overload -- this file must run
-- after that one too, or that migration's `create or replace` would silently
-- resurrect a stale 6-arg overload alongside this file's 7-arg one.
--
-- WHY THIS TOUCHES care_message_threads
-- ---------------------------------------------------------------------------
-- profile_access + the sponsor three-way messaging feature
-- (20260731181318_care_messages_three_way) is, today, the ONLY "someone
-- else can see this patient's record" mechanism on the whole platform.
-- care_message_threads_select/care_messages_select/*_insert all read
-- `private.can_read_clinical(patient_id)` unconditionally — a consented
-- sponsor (profile_access.clinical_access = true) can read and post into
-- EVERY thread a patient has, with no per-thread exception. That is exactly
-- right for "the daughter in London asking about her mother's blood
-- pressure" (the feature's own founder rationale) and exactly wrong for a
-- thread about a positive STI result, a contraception request, or a
-- fertility concern the patient never chose to share with whoever holds
-- clinical_access on their profile_access grant.
--
-- Every screening_results/clinician_alerts/escalations row from this whole
-- module is ALREADY excluded from sponsor visibility whenever the patient
-- has not granted clinical_access at all -- that part needs no fix. This
-- migration closes the one remaining gap: a thread that must stay hidden
-- from a sponsor EVEN WHEN clinical_access has been granted for everything
-- else. A column, not a workaround: `confidential` on the thread, checked in
-- the same four policies + the one RPC that already reference
-- can_read_clinical.
--
-- RECONCILED 2026-09-02 against main-dev's category-scoped clinical access
-- (20260830103251/20260830123653, PR #411, merged the same day this branch
-- was reconciled): private.can_read_clinical is now a 2-arg (patient,
-- category) function -- the flat profile_access.clinical_access boolean
-- this migration was originally written against has been replaced by 8
-- independently toggleable categories, one of them 'messaging'
-- (care_message_threads/care_messages' own category -- distinct from
-- 'reproductive_health', which gates reproductive_health_profiles and is
-- excluded from break-glass emergency access unconditionally). The legacy
-- 1-arg overload still exists live for an unrelated in-flight branch's
-- compatibility
-- (20260902190500_preserve_legacy_can_read_clinical_overload_for_pr377_compat)
-- and this migration's original text would still have compiled against it
-- -- but that overload only checks the old boolean, which the category-grant
-- UI no longer sets, so leaving it as-is would have silently stopped a
-- legitimately category-granted sponsor from ever reaching a non-confidential
-- thread, while still letting a pre-cutover blanket clinical_access=true
-- grantee read one without any explicit 'messaging' category grant --
-- exactly the bundling category-scoped access exists to prevent. Every
-- can_read_clinical(patient_id) call below is now
-- can_read_clinical(patient_id, 'messaging') plus
-- has_emergency_access(patient_id, 'messaging'), matching the pattern
-- main-dev already applies to these same two tables for every other
-- category. The `confidential` flag keeps doing exactly what it always did
-- -- narrowing visibility further, never widening it. It is unrelated to
-- the reproductive_health category itself: a thread needs confidential=true
-- because 'messaging' access and 'reproductive_health' access are two
-- different grants a caregiver could hold independently, and a thread being
-- about SRH content is not something care_message_threads can know
-- structurally.
--
-- start_care_thread also gained a 6th parameter (p_category) on main-dev in
-- the same window (20260830014522, then a self-access fix in 20260902010000),
-- independently of this migration's own p_confidential addition. Both are
-- folded into one final 7-arg signature below instead of leaving two
-- same-arity-6 overloads -- (text,text,uuid,uuid,uuid,care_message_category)
-- and (text,text,uuid,uuid,uuid,boolean) -- coexisting, which PostgREST
-- cannot disambiguate. The self-access fix (a patient messaging their own
-- care team is not "acting for someone else" and needs no staff/caregiver
-- check) is preserved too.
--
-- MODULE-WIDE CONFIDENTIALITY CHOICE (spec §47.13: "confidentiality first")
-- ---------------------------------------------------------------------------
-- Every new table in this module (sti_risk_checks, sti_case_episodes,
-- sti_partner_notifications, contraception_plans,
-- emergency_contraception_requests, fertility_assessments,
-- sexual_health_screens) deliberately has NO profile_access/can_read_clinical
-- clause at all -- patient-self or org staff, full stop. That is a stricter
-- posture than reproductive_health_profiles (which lets a profile_access
-- grantee with an explicit reproductive_health category grant, or a
-- dependent-account guardian, read it) -- a deliberate choice for this
-- module, not an oversight; see each table's own migration header. Whether
-- these tables should also honour that same explicit-grant/guardian path is
-- flagged back to the founder, not decided here -- unlike
-- care_message_threads, they never referenced can_read_clinical at all, so
-- category-scoping does not change their behaviour either way. Any
-- SRH-related care_message_thread the app opens (e.g. from the STI
-- case-review screen, or a patient starting a conversation from inside the
-- Sexual & Reproductive Health section) is expected to always pass
-- confidential = true.

alter table public.care_message_threads
  add column if not exists confidential boolean not null default false;

comment on column public.care_message_threads.confidential is
  'True when this thread must stay invisible to any profile_access grantee with a ''messaging'' category grant (spec section 47.12) -- including a caregiver holding messaging access without a separate reproductive_health grant. The patient and org staff can always read/post regardless of this flag; it only ever narrows category-grant/emergency-access visibility, never the patient''s own.';

drop policy if exists care_message_threads_select on public.care_message_threads;
create policy care_message_threads_select on public.care_message_threads
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or (
      not confidential
      and (
        private.can_read_clinical(patient_id, 'messaging')
        or private.has_emergency_access(patient_id, 'messaging')
      )
    )
  );

drop policy if exists care_message_threads_insert on public.care_message_threads;
create policy care_message_threads_insert on public.care_message_threads
  for insert to authenticated
  with check (
    (patient_id = (select auth.uid()) and organisation_id = private.current_org_id())
    or private.is_org_staff(organisation_id)
    or (
      not confidential
      and (
        private.can_read_clinical(patient_id, 'messaging')
        or private.has_emergency_access(patient_id, 'messaging')
      )
    )
  );

drop policy if exists care_messages_select on public.care_messages;
create policy care_messages_select on public.care_messages
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or (
      (
        private.can_read_clinical(patient_id, 'messaging')
        or private.has_emergency_access(patient_id, 'messaging')
      )
      and exists (
        select 1 from public.care_message_threads t
        where t.id = thread_id and not t.confidential
      )
    )
  );

drop policy if exists care_messages_insert on public.care_messages;
create policy care_messages_insert on public.care_messages
  for insert to authenticated
  with check (
    exists (
      select 1 from public.care_message_threads t
      where t.id = thread_id
        and (
          t.patient_id = (select auth.uid())
          or private.is_org_staff(t.organisation_id)
          or (
            not t.confidential
            and (
              private.can_read_clinical(t.patient_id, 'messaging')
              or private.has_emergency_access(t.patient_id, 'messaging')
            )
          )
        )
    )
  );

-- start_care_thread gains p_confidential (default false, unchanged for every
-- existing caller) folded onto main-dev's own p_category addition -- see this
-- migration's header. A sponsor/caregiver opening a thread for someone they
-- support can never mark it confidential -- that would be a caregiver
-- creating a conversation the patient's OTHER caregivers can't see while the
-- caregiver who created it still can, which is not what confidentiality is
-- for here; only the patient themselves or org staff may set it. The
-- self-access fix (p_patient_id = the caller's own auth.uid() is the patient
-- messaging about themselves, not "acting for someone else") is preserved
-- from 20260902010000.
--
-- Both of main-dev's own 6-arg overloads
-- ((text,text,uuid,uuid,uuid,care_message_category) from
-- 20260830014522/20260902010000, and any transient
-- (text,text,uuid,uuid,uuid,boolean) this migration would otherwise have
-- created) are dropped explicitly first so exactly one start_care_thread
-- exists, the same requirement PostgREST's RPC dispatch has for any
-- overloaded function name.
drop function if exists public.start_care_thread(text, text, uuid, uuid, uuid);
drop function if exists public.start_care_thread(text, text, uuid, uuid, uuid, public.care_message_category);
drop function if exists public.start_care_thread(text, text, uuid, uuid, uuid, boolean);

create or replace function public.start_care_thread(
  p_subject text,
  p_body text,
  p_patient_id uuid default null,
  p_escalation_id uuid default null,
  p_care_plan_id uuid default null,
  p_category public.care_message_category default 'general'::public.care_message_category,
  p_confidential boolean default false
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid;
  v_patient uuid;
  v_thread_id uuid;
  v_is_staff_or_self boolean;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if length(coalesce(trim(p_subject), '')) = 0 then raise exception 'subject required'; end if;
  if length(coalesce(trim(p_body), '')) = 0 then raise exception 'message required'; end if;

  if p_patient_id is not null and p_patient_id <> v_uid then
    -- Staff opening a thread for a patient, or a consented caregiver opening
    -- one for the person they support.
    select organisation_id into v_org from public.profiles where id = p_patient_id;
    v_patient := p_patient_id;
    v_is_staff_or_self := private.is_org_staff(v_org);
    if v_org is null
       or not (v_is_staff_or_self or private.can_read_clinical(p_patient_id, 'messaging')) then
      raise exception 'not authorised' using errcode = '42501';
    end if;
  else
    -- Patient opening their own thread (p_patient_id null, or explicitly
    -- their own auth.uid()).
    select organisation_id into v_org from public.profiles where id = v_uid;
    v_patient := v_uid;
    v_is_staff_or_self := true;
  end if;
  if v_org is null then raise exception 'no organisation'; end if;

  insert into public.care_message_threads
    (organisation_id, patient_id, subject, created_by, escalation_id, care_plan_id, category, confidential)
  values (
    v_org, v_patient, trim(p_subject), v_uid, p_escalation_id, p_care_plan_id, p_category,
    coalesce(p_confidential, false) and v_is_staff_or_self
  )
  returning id into v_thread_id;

  insert into public.care_messages (thread_id, body) values (v_thread_id, trim(p_body));
  return v_thread_id;
end;
$$;

revoke execute on function public.start_care_thread(text, text, uuid, uuid, uuid, public.care_message_category, boolean) from public, anon;
grant execute on function public.start_care_thread(text, text, uuid, uuid, uuid, public.care_message_category, boolean) to authenticated;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'care_message_threads' and column_name = 'confidential'
  ) then
    raise exception 'FAIL: care_message_threads.confidential was not added';
  end if;

  -- Substring check on the column name only, not on the NOT keyword's case --
  -- Postgres's own expression deparser (pg_get_expr, backing pg_policies.qual)
  -- always renders SQL keywords upper-case regardless of how a migration's
  -- source text wrote them, so a literal 'not confidential' (lower-case)
  -- match would be brittle.
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'care_message_threads'
      and cmd = 'SELECT' and qual ilike '%confidential%'
  ) then
    raise exception 'FAIL: care_message_threads SELECT policy does not check confidential';
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'care_messages'
      and cmd = 'SELECT' and qual like '%confidential%'
  ) then
    raise exception 'FAIL: care_messages SELECT policy does not check confidential';
  end if;

  -- Category-scoped access, not the retired flat clinical_access boolean:
  -- every rewritten policy must call the 2-arg can_read_clinical(uuid,
  -- care_access_category) with the 'messaging' category, matching the
  -- pattern main-dev applies everywhere else category-scoped access reads
  -- care_message_threads/care_messages.
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename in ('care_message_threads', 'care_messages')
      and qual like '%can_read_clinical(%' and qual not like '%messaging%'
  ) then
    raise exception 'FAIL: a care_message_threads/care_messages policy still calls can_read_clinical without the messaging category';
  end if;

  -- The patient and org staff must never be narrowed by this flag -- check
  -- for the two clauses by function name rather than exact auth.uid()
  -- subselect formatting, which Postgres's own deparser may normalise.
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'care_message_threads'
      and cmd = 'SELECT' and qual like '%auth.uid%' and qual like '%is_org_staff%'
  ) then
    raise exception 'FAIL: care_message_threads SELECT policy lost the patient-self or org-staff clause';
  end if;

  if exists (
    select 1 from pg_proc
    where proname = 'start_care_thread' and pronamespace = 'public'::regnamespace
      and pg_get_function_identity_arguments(oid) <> 'p_subject text, p_body text, p_patient_id uuid, p_escalation_id uuid, p_care_plan_id uuid, p_category care_message_category, p_confidential boolean'
  ) then
    raise exception 'FAIL: more than one start_care_thread overload exists, or its signature drifted';
  end if;

  if has_function_privilege('anon', 'public.start_care_thread(text,text,uuid,uuid,uuid,public.care_message_category,boolean)', 'EXECUTE') then
    raise exception 'FAIL: anon must not be able to open a care conversation';
  end if;

  raise notice 'PASS: care_message_threads.confidential installed and enforced across select/insert policies + start_care_thread, category-scoped';
end $$;
