-- In-app care-team messaging (P2 of docs/OMADA_FEATURE_PROPOSALS.md §2).
--
-- A threaded, on-the-record message channel between a patient and their care
-- team, IN-APP ONLY. WhatsApp/SMS may *notify* the patient that a reply is
-- waiting (notifications-only rule), but the message itself lives in the app —
-- this is not a WhatsApp transactional flow, and inbound WhatsApp is never
-- parsed into a message here.
--
-- Threads optionally link to an escalation or care plan so a conversation is
-- anchored to the record. Messages are append-only (SELECT+INSERT only, like
-- patient_timeline). Author identity + doctor attribution are SERVER-DERIVED by
-- a BEFORE INSERT trigger (forge-proof) — the client never sets who sent a
-- message. A care_team message is attributed to a real clinical_staff row only
-- when one exists (null-gated, same rule as ReviewedByDoctor); a Care
-- Coordinator or other non-clinical staff resolves to no clinician attribution.

do $$ begin
  if not exists (select 1 from pg_type where typname = 'care_message_author') then
    create type public.care_message_author as enum ('patient', 'care_team');
  end if;
  if not exists (select 1 from pg_type where typname = 'care_message_thread_status') then
    create type public.care_message_thread_status as enum ('open', 'closed');
  end if;
end $$;

create table if not exists public.care_message_threads (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  patient_id      uuid not null references public.profiles (id) on delete cascade,
  subject         text not null,
  status          public.care_message_thread_status not null default 'open',
  escalation_id   uuid references public.escalations (id) on delete set null,
  care_plan_id    uuid references public.care_plans (id) on delete set null,
  created_by      uuid references public.profiles (id) on delete set null,
  last_message_at timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists care_message_threads_patient_idx
  on public.care_message_threads (patient_id, last_message_at desc);
create index if not exists care_message_threads_org_status_idx
  on public.care_message_threads (organisation_id, status, last_message_at desc);
create index if not exists care_message_threads_escalation_idx
  on public.care_message_threads (escalation_id);
create index if not exists care_message_threads_care_plan_idx
  on public.care_message_threads (care_plan_id);

create table if not exists public.care_messages (
  id                     uuid primary key default gen_random_uuid(),
  organisation_id        uuid not null references public.organisations (id) on delete restrict,
  patient_id             uuid not null references public.profiles (id) on delete cascade,
  thread_id              uuid not null references public.care_message_threads (id) on delete cascade,
  -- Nullable so a profile hard-delete drops the author link without destroying
  -- the append-only message. The BEFORE INSERT trigger always sets it to the
  -- caller at insert time, so it is never null for a live author.
  author_profile_id      uuid references public.profiles (id) on delete set null,
  author_role            public.care_message_author not null,
  body                   text not null,
  -- Null unless the author is a real clinician (null-gated attribution).
  actor_clinical_staff_id uuid references public.clinical_staff (id) on delete set null,
  created_at             timestamptz not null default now()
);

create index if not exists care_messages_thread_idx
  on public.care_messages (thread_id, created_at);

drop trigger if exists care_message_threads_set_updated_at on public.care_message_threads;
create trigger care_message_threads_set_updated_at
  before update on public.care_message_threads
  for each row execute function private.set_updated_at();

-- Server-derive author identity + attribution, and enforce thread membership.
create or replace function private.enforce_care_message_author()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid;
  v_patient uuid;
  v_status public.care_message_thread_status;
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

  -- A non-staff caller may only post to their own thread.
  if not private.is_org_staff(v_org) and v_uid is distinct from v_patient then
    raise exception 'not authorised';
  end if;

  -- Consistency + forge-proofing: derive these from the thread / session,
  -- never from client input.
  new.organisation_id := v_org;
  new.patient_id := v_patient;
  new.author_profile_id := v_uid;
  if private.is_org_staff(v_org) then
    new.author_role := 'care_team';
    new.actor_clinical_staff_id := private.timeline_staff_from_profile(v_uid, v_org);
  else
    new.author_role := 'patient';
    new.actor_clinical_staff_id := null;
  end if;
  return new;
end;
$$;

drop trigger if exists care_messages_enforce_author on public.care_messages;
create trigger care_messages_enforce_author
  before insert on public.care_messages
  for each row execute function private.enforce_care_message_author();

-- After a message lands: bump the thread, write a timeline event, and (only for
-- a care-team reply — the direction where the patient is waiting to hear back)
-- enqueue a WhatsApp notification. Patient→team posts surface in the staff
-- worklist, so they need no push.
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
    case when new.author_role = 'care_team'
      then 'Your care team sent you a message'
      else 'You messaged your care team' end,
    new.created_at,
    new.actor_clinical_staff_id,
    jsonb_build_object('thread_id', new.thread_id::text, 'author_role', new.author_role)
  );

  if new.author_role = 'care_team' then
    insert into public.notifications
      (organisation_id, recipient_id, channel, status, template, payload)
    values (
      new.organisation_id, new.patient_id, 'whatsapp', 'pending', 'new_care_message',
      jsonb_build_object('thread_id', new.thread_id::text)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists care_messages_after_insert on public.care_messages;
create trigger care_messages_after_insert
  after insert on public.care_messages
  for each row execute function private.after_care_message_insert();

-- RLS ---------------------------------------------------------------------
alter table public.care_message_threads enable row level security;
alter table public.care_messages enable row level security;

drop policy if exists care_message_threads_select on public.care_message_threads;
create policy care_message_threads_select on public.care_message_threads
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

drop policy if exists care_message_threads_insert on public.care_message_threads;
create policy care_message_threads_insert on public.care_message_threads
  for insert to authenticated
  with check (
    (patient_id = (select auth.uid()) and organisation_id = private.current_org_id())
    or private.is_org_staff(organisation_id)
  );

drop policy if exists care_message_threads_update on public.care_message_threads;
create policy care_message_threads_update on public.care_message_threads
  for update to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id))
  with check (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

drop policy if exists care_messages_select on public.care_messages;
create policy care_messages_select on public.care_messages
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

-- Insert is gated to the thread's participants; the BEFORE trigger overwrites
-- every author field, so a forged author_role/patient_id can't stick.
drop policy if exists care_messages_insert on public.care_messages;
create policy care_messages_insert on public.care_messages
  for insert to authenticated
  with check (
    exists (
      select 1 from public.care_message_threads t
      where t.id = thread_id
        and (t.patient_id = (select auth.uid()) or private.is_org_staff(t.organisation_id))
    )
  );

-- Append-only: no update/delete policy, no update/delete grant.
grant select, insert, update on public.care_message_threads to authenticated;
grant select, insert on public.care_messages to authenticated;

-- RPCs — ergonomic, forge-proof entry points. Both run SECURITY DEFINER and
-- re-derive the caller's identity; the BEFORE INSERT trigger still governs
-- authorship on the message insert.
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
    -- Staff opening a thread for a patient.
    select organisation_id into v_org from public.profiles where id = p_patient_id;
    v_patient := p_patient_id;
    if v_org is null or not private.is_org_staff(v_org) then
      raise exception 'not authorised';
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

create or replace function public.post_care_message(
  p_thread_id uuid,
  p_body text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_message_id uuid;
begin
  if (select auth.uid()) is null then raise exception 'not authenticated'; end if;
  if length(coalesce(trim(p_body), '')) = 0 then raise exception 'message required'; end if;
  -- The BEFORE INSERT trigger validates thread membership + open status and
  -- derives all author fields; it raises if the caller may not post.
  insert into public.care_messages (thread_id, body) values (p_thread_id, trim(p_body))
  returning id into v_message_id;
  return v_message_id;
end;
$$;

revoke execute on function public.start_care_thread(text, text, uuid, uuid, uuid) from public, anon;
revoke execute on function public.post_care_message(uuid, text) from public, anon;
grant execute on function public.start_care_thread(text, text, uuid, uuid, uuid) to authenticated;
grant execute on function public.post_care_message(uuid, text) to authenticated;
