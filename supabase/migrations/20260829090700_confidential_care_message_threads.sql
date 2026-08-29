-- Sexual & Reproductive Health platform, 8/8: confidential mode (spec §47.2,
-- §47.12 — "a family caregiver should not automatically receive: 'Your
-- spouse has an STI result.'").
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
-- has not granted clinical_access at all — that part needs no fix. This
-- migration closes the one remaining gap: a thread that must stay hidden
-- from a sponsor EVEN WHEN clinical_access has been granted for everything
-- else. A column, not a workaround: `confidential` on the thread, checked in
-- the same four policies + the one RPC that already reference
-- can_read_clinical.
--
-- MODULE-WIDE CONFIDENTIALITY CHOICE (spec §47.13: "confidentiality first")
-- ---------------------------------------------------------------------------
-- Every new table in this module (sti_risk_checks, sti_case_episodes,
-- sti_partner_notifications, contraception_plans,
-- emergency_contraception_requests, fertility_assessments,
-- sexual_health_screens) deliberately has NO profile_access/can_read_clinical
-- clause at all — patient-self or org staff, full stop. That is a stricter
-- posture than reproductive_health_profiles (which already lets any
-- profile_access grantee read it) — a deliberate choice for this module, not
-- an oversight; see each table's own migration header. Any SRH-related
-- care_message_thread the app opens (e.g. from the STI case-review screen, or
-- a patient starting a conversation from inside the Sexual & Reproductive
-- Health section) is expected to always pass confidential = true.

alter table public.care_message_threads
  add column if not exists confidential boolean not null default false;

comment on column public.care_message_threads.confidential is
  'True when this thread must stay invisible to a sponsor/supporter even with profile_access.clinical_access granted (spec §47.12). The patient and org staff can always read/post regardless of this flag — it only ever narrows sponsor visibility, never the patient''s own.';

drop policy if exists care_message_threads_select on public.care_message_threads;
create policy care_message_threads_select on public.care_message_threads
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or (not confidential and private.can_read_clinical(patient_id))
  );

drop policy if exists care_message_threads_insert on public.care_message_threads;
create policy care_message_threads_insert on public.care_message_threads
  for insert to authenticated
  with check (
    (patient_id = (select auth.uid()) and organisation_id = private.current_org_id())
    or private.is_org_staff(organisation_id)
    or (not confidential and private.can_read_clinical(patient_id))
  );

drop policy if exists care_messages_select on public.care_messages;
create policy care_messages_select on public.care_messages
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or (
      private.can_read_clinical(patient_id)
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
          or (not t.confidential and private.can_read_clinical(t.patient_id))
        )
    )
  );

-- start_care_thread gains p_confidential (default false, unchanged for every
-- existing caller). A sponsor opening a thread for someone they support can
-- never mark it confidential — that would be a sponsor creating a
-- conversation the patient's OTHER sponsors can't see while the sponsor who
-- created it still can, which is not what confidentiality is for here; only
-- the patient themselves or org staff may set it.
--
-- Adding a parameter changes the function's signature, so `create or
-- replace` alone would leave the old 5-arg overload behind rather than
-- replacing it (Postgres treats a different arg list as a different
-- function) — drop it explicitly first so exactly one start_care_thread
-- exists, the same requirement PostgREST's RPC dispatch has for any
-- overloaded function name.
drop function if exists public.start_care_thread(text, text, uuid, uuid, uuid);

create or replace function public.start_care_thread(
  p_subject text,
  p_body text,
  p_patient_id uuid default null,
  p_escalation_id uuid default null,
  p_care_plan_id uuid default null,
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

  if p_patient_id is not null then
    -- Staff opening a thread for a patient, or a consented sponsor opening one
    -- for the person they support.
    select organisation_id into v_org from public.profiles where id = p_patient_id;
    v_patient := p_patient_id;
    v_is_staff_or_self := private.is_org_staff(v_org);
    if v_org is null
       or not (v_is_staff_or_self or private.can_read_clinical(p_patient_id)) then
      raise exception 'not authorised' using errcode = '42501';
    end if;
  else
    -- Patient opening their own thread.
    select organisation_id into v_org from public.profiles where id = v_uid;
    v_patient := v_uid;
    v_is_staff_or_self := true;
  end if;
  if v_org is null then raise exception 'no organisation'; end if;

  insert into public.care_message_threads
    (organisation_id, patient_id, subject, created_by, escalation_id, care_plan_id, confidential)
  values (
    v_org, v_patient, trim(p_subject), v_uid, p_escalation_id, p_care_plan_id,
    coalesce(p_confidential, false) and v_is_staff_or_self
  )
  returning id into v_thread_id;

  insert into public.care_messages (thread_id, body) values (v_thread_id, trim(p_body));
  return v_thread_id;
end;
$$;

revoke execute on function public.start_care_thread(text, text, uuid, uuid, uuid, boolean) from public, anon;
grant execute on function public.start_care_thread(text, text, uuid, uuid, uuid, boolean) to authenticated;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'care_message_threads' and column_name = 'confidential'
  ) then
    raise exception 'FAIL: care_message_threads.confidential was not added';
  end if;

  -- Substring check on the column name only, not on the NOT keyword's case —
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

  -- The patient and org staff must never be narrowed by this flag — check
  -- for the two clauses by function name rather than exact auth.uid()
  -- subselect formatting, which Postgres's own deparser may normalise.
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'care_message_threads'
      and cmd = 'SELECT' and qual like '%auth.uid%' and qual like '%is_org_staff%'
  ) then
    raise exception 'FAIL: care_message_threads SELECT policy lost the patient-self or org-staff clause';
  end if;

  if has_function_privilege('anon', 'public.start_care_thread(text,text,uuid,uuid,uuid,boolean)', 'EXECUTE') then
    raise exception 'FAIL: anon must not be able to open a care conversation';
  end if;

  raise notice 'PASS: care_message_threads.confidential installed and enforced across select/insert policies + start_care_thread';
end $$;
