-- One conversation, three people: the patient, their care team, and whoever
-- they have consented to have in the room.
--
-- Founder direction 2026-07-31: "the conversation should be able to be three
-- way in which the doctor, sponsor and patient will use the same chat but with
-- time stamp and showing who asked the question. This helps with parental care
-- for people abroad with family in Nigeria."
--
-- The daughter in London asks the question, the doctor answers it once, and the
-- mother in Enugu sees both — rather than the daughter relaying an answer she
-- half-heard down a phone line. It is one thread, not a side channel: nothing
-- here lets anyone say something the patient cannot read.
--
-- Participation rides on the SAME switch as clinical visibility
-- (profile_access.clinical_access, 20260731181143), so a patient revoking
-- consent removes the sponsor from the conversation in the same click that
-- removes them from the record. There is no second thing to remember to turn
-- off.
--
-- Row counts before this migration: care_messages 0, care_message_threads 0.

-- Who said it, frozen at the moment they said it.
--
-- The alternative was resolving names at render time, which cannot work here:
-- profiles_select lets a sponsor read the patient, never the patient read the
-- sponsor, so the mother would see "someone" against her own daughter's
-- question. Freezing the display name also means a later name change does not
-- silently rewrite who appears to have said what — the actor_display
-- discipline the v3 proof_log spec asks for.
alter table public.care_messages
  add column if not exists author_display text;

comment on column public.care_messages.author_display is
  'Server-derived at insert by private.enforce_care_message_author. Never client-supplied.';

update public.care_messages m
   set author_display = coalesce(
     (select cs.full_name from public.clinical_staff cs where cs.id = m.actor_clinical_staff_id),
     (select p.full_name from public.profiles p where p.id = m.author_profile_id))
 where m.author_display is null;

-- Author identity, still entirely server-derived.
--
-- Byte-identical to the live definition apart from the sponsor branch and
-- author_display; the live version was confirmed to match 20260719110000
-- exactly before this replaced it.
create or replace function private.enforce_care_message_author()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid;
  v_patient uuid;
  v_status public.care_message_thread_status;
  v_staff uuid;
begin
  select organisation_id, patient_id, status
    into v_org, v_patient, v_status
    from public.care_message_threads where id = new.thread_id;
  if v_org is null then
    raise exception 'thread not found';
  end if;
  if v_status = 'closed' then
    raise exception 'thread is closed';
  end if;

  -- Consistency + forge-proofing: derive these from the thread / session,
  -- never from client input.
  new.organisation_id := v_org;
  new.patient_id := v_patient;
  new.author_profile_id := v_uid;

  if private.is_org_staff(v_org) then
    v_staff := private.timeline_staff_from_profile(v_uid, v_org);
    new.author_role := 'care_team';
    new.actor_clinical_staff_id := v_staff;
    -- Null-gated exactly as before: a name only when a real clinical_staff row
    -- backs it, and no title invented here — the UI still decides how to
    -- render a clinician from actor_clinical_staff_id.
    new.author_display := coalesce(
      (select cs.full_name from public.clinical_staff cs where cs.id = v_staff),
      'Care team');

  elsif v_uid is not distinct from v_patient then
    new.author_role := 'patient';
    new.actor_clinical_staff_id := null;
    new.author_display := (select p.full_name from public.profiles p where p.id = v_patient);

  elsif exists (
    select 1 from public.profile_access pa
    where pa.profile_id = v_patient
      and pa.grantee_user_id = v_uid
      and pa.clinical_access
  ) then
    new.author_role := 'sponsor';
    new.actor_clinical_staff_id := null;
    new.author_display := (select p.full_name from public.profiles p where p.id = v_uid);

  else
    raise exception 'not authorised' using errcode = '42501';
  end if;

  return new;
end;
$$;

-- Everyone in the room hears about it, except whoever just spoke.
--
-- in_app only, as the patient<->care-team notification already is since
-- 20260730212458. A sponsor is frequently abroad with no Nigerian number, and
-- the payload deliberately carries no clinical content at all — just that
-- there is something to read.
create or replace function private.after_care_message_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.care_message_threads
    set last_message_at = new.created_at, updated_at = now()
    where id = new.thread_id;

  perform private.record_timeline_event(
    new.organisation_id, new.patient_id, 'message_posted',
    'care_messages', new.id,
    'New message',
    case new.author_role
      when 'care_team' then 'Your care team sent you a message'
      when 'sponsor' then coalesce(new.author_display, 'Someone who supports you')
                          || ' messaged your care team'
      else 'You messaged your care team' end,
    new.created_at,
    new.actor_clinical_staff_id,
    jsonb_build_object('thread_id', new.thread_id::text, 'author_role', new.author_role)
  );

  -- The patient is told about anything they did not write themselves. That now
  -- includes a sponsor's question, which is the point: consent to be in the
  -- conversation is not consent to speak for them unseen.
  if new.author_role is distinct from 'patient' then
    insert into public.notifications
      (organisation_id, recipient_id, channel, status, template, payload)
    values (
      new.organisation_id, new.patient_id, 'in_app', 'pending', 'new_care_message',
      jsonb_build_object('thread_id', new.thread_id::text,
                         'author_role', new.author_role)
    );
  end if;

  insert into public.notifications
    (organisation_id, recipient_id, channel, status, template, payload)
  select
    new.organisation_id, pa.grantee_user_id, 'in_app', 'pending', 'new_care_message',
    jsonb_build_object('thread_id', new.thread_id::text,
                       'author_role', new.author_role)
  from public.profile_access pa
  where pa.profile_id = new.patient_id
    and pa.clinical_access
    and pa.grantee_user_id is distinct from new.author_profile_id;

  return new;
end;
$$;

-- RLS: read and post, never close.
--
-- care_message_threads_update is deliberately left alone, so a sponsor cannot
-- close a conversation the patient is still having.
drop policy if exists care_message_threads_select on public.care_message_threads;
create policy care_message_threads_select on public.care_message_threads
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id)
  );

drop policy if exists care_messages_select on public.care_messages;
create policy care_messages_select on public.care_messages
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id)
  );

drop policy if exists care_message_threads_insert on public.care_message_threads;
create policy care_message_threads_insert on public.care_message_threads
  for insert to authenticated
  with check (
    (patient_id = (select auth.uid()) and organisation_id = private.current_org_id())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id)
  );

drop policy if exists care_messages_insert on public.care_messages;
create policy care_messages_insert on public.care_messages
  for insert to authenticated
  with check (
    exists (
      select 1 from public.care_message_threads t
      where t.id = thread_id
        and (t.patient_id = (select auth.uid())
             or private.is_org_staff(t.organisation_id)
             or private.can_read_clinical(t.patient_id))
    )
  );

-- Opening a thread on behalf of someone you support.
--
-- Only the authorisation branch changes; the rest is the live definition
-- verbatim.
create or replace function public.start_care_thread(
  p_subject text,
  p_body text,
  p_patient_id uuid default null,
  p_escalation_id uuid default null,
  p_care_plan_id uuid default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid;
  v_patient uuid;
  v_thread_id uuid;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if length(coalesce(trim(p_subject), '')) = 0 then raise exception 'subject required'; end if;
  if length(coalesce(trim(p_body), '')) = 0 then raise exception 'message required'; end if;

  if p_patient_id is not null then
    -- Staff opening a thread for a patient, or a consented sponsor opening one
    -- for the person they support.
    select organisation_id into v_org from public.profiles where id = p_patient_id;
    v_patient := p_patient_id;
    if v_org is null
       or not (private.is_org_staff(v_org) or private.can_read_clinical(p_patient_id)) then
      raise exception 'not authorised' using errcode = '42501';
    end if;
  else
    -- Patient opening their own thread.
    select organisation_id into v_org from public.profiles where id = v_uid;
    v_patient := v_uid;
  end if;
  if v_org is null then raise exception 'no organisation'; end if;

  insert into public.care_message_threads
    (organisation_id, patient_id, subject, created_by, escalation_id, care_plan_id)
  values (v_org, v_patient, trim(p_subject), v_uid, p_escalation_id, p_care_plan_id)
  returning id into v_thread_id;

  insert into public.care_messages (thread_id, body) values (v_thread_id, trim(p_body));
  return v_thread_id;
end;
$$;

revoke execute on function public.start_care_thread(text, text, uuid, uuid, uuid) from public, anon;
grant execute on function public.start_care_thread(text, text, uuid, uuid, uuid) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.start_care_thread(text,text,uuid,uuid,uuid)', 'EXECUTE') then
    raise exception 'anon must not be able to open a care conversation';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'care_messages'
      and cmd = 'SELECT' and qual like '%can_read_clinical%'
  ) then
    raise exception 'care_messages read policy was not extended';
  end if;

  -- A sponsor must never be able to close someone else's conversation.
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'care_message_threads'
      and cmd = 'UPDATE'
      and (coalesce(qual, '') || coalesce(with_check, '')) like '%can_read_clinical%'
  ) then
    raise exception 'thread UPDATE must stay with the patient and org staff';
  end if;
end $$;
