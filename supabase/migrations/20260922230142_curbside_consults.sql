-- Tarragon Health — doctor-to-doctor "curbside consult" messaging.
--
-- Gap: the Senior Medical Officer / Specialist tier is otherwise unusually
-- complete (Master Operating Plan §4/§8), but there is no in-app channel for
-- one doctor to quickly ask a colleague an informal clinical question —
-- today the only cross-clinician channels are all patient-initiated
-- (second_opinion_requests, senior_case_reviews, async_consults) or a
-- structured referral (specialist_referrals). A curbside consult is neither:
-- it is peer-to-peer, informal, and deliberately NOT part of the patient's
-- chart (a real curbside conversation is not charted either) — so, unlike
-- care_messages, nothing here writes to patient_timeline.
--
-- Modelled directly on care_message_threads/care_messages
-- (20260719110000_care_messages.sql) for the append-only, server-derived-
-- authorship shape, with the participant model changed from
-- patient<->org-staff to clinician<->clinician:
--   - Both participants are resolved from clinical_staff, same org, active,
--     and never a Care Coordinator (private.timeline_staff_from_profile
--     already excludes nothing by tier, so tier is checked explicitly here).
--   - Author identity on every message is SERVER-DERIVED by a BEFORE INSERT
--     trigger from auth.uid() — the client can never post as someone else,
--     same forge-proofing as care_messages.
--   - "Awaiting reply" is last_message_sender_id <> the caller's own
--     clinical_staff id, deliberately NOT a read-timestamp pair (care_
--     messages' care_team_last_read_at approach) — two participants only,
--     so "the other person sent last" is the whole signal, and adding a
--     second pair of *_last_read_at columns for a two-party thread would be
--     complexity with no behaviour it changes.
--   - patient_id is optional CONTEXT ONLY (which case prompted the
--     question), not a new PHI-access grant: both participants are already
--     org staff with the platform's existing broad is_org_staff read access
--     to any patient record in their own org, so linking a thread to a
--     patient_id exposes nothing a curbside consult between two staff
--     members couldn't already see by opening the chart directly. Only
--     validated to belong to the same organisation.
--   - Notifications: in_app only, same precedent as
--     20260730212458_care_messages_in_app_notification_and_coordinator_copy.sql
--     (WhatsApp/SMS are never a transactional interface, CLAUDE.md's
--     Non-Negotiable Business Rules).

create type public.curbside_consult_status as enum ('open', 'closed');

create table public.curbside_consult_threads (
  id                           uuid primary key default gen_random_uuid(),
  organisation_id              uuid not null references public.organisations (id) on delete restrict,
  initiator_clinical_staff_id  uuid not null references public.clinical_staff (id) on delete restrict,
  recipient_clinical_staff_id  uuid not null references public.clinical_staff (id) on delete restrict,
  subject                      text not null,
  status                       public.curbside_consult_status not null default 'open',
  -- Optional "regarding this patient" context only — see header. Never used
  -- by RLS/notifications to grant access; purely a link for the two
  -- participants' own reference.
  patient_id                   uuid references public.profiles (id) on delete set null,
  last_message_at              timestamptz not null default now(),
  last_message_sender_id       uuid references public.clinical_staff (id) on delete set null,
  closed_at                    timestamptz,
  closed_by                    uuid references public.clinical_staff (id) on delete set null,
  created_at                   timestamptz not null default now(),
  updated_at                   timestamptz not null default now(),
  constraint curbside_consult_threads_distinct_participants
    check (initiator_clinical_staff_id <> recipient_clinical_staff_id)
);

create index curbside_consult_threads_initiator_idx
  on public.curbside_consult_threads (initiator_clinical_staff_id, status, last_message_at desc);
create index curbside_consult_threads_recipient_idx
  on public.curbside_consult_threads (recipient_clinical_staff_id, status, last_message_at desc);
create index curbside_consult_threads_org_idx
  on public.curbside_consult_threads (organisation_id, status);
create index curbside_consult_threads_patient_idx
  on public.curbside_consult_threads (patient_id) where patient_id is not null;

create table public.curbside_consult_messages (
  id                       uuid primary key default gen_random_uuid(),
  organisation_id          uuid not null references public.organisations (id) on delete restrict,
  thread_id                uuid not null references public.curbside_consult_threads (id) on delete cascade,
  -- Nullable so a profile hard-delete drops the author link without
  -- destroying the append-only message (same reasoning as
  -- care_messages.author_profile_id). Always set by the BEFORE INSERT
  -- trigger at insert time for a live author.
  sender_clinical_staff_id uuid references public.clinical_staff (id) on delete set null,
  body                     text not null,
  created_at               timestamptz not null default now()
);

create index curbside_consult_messages_thread_idx
  on public.curbside_consult_messages (thread_id, created_at);

drop trigger if exists curbside_consult_threads_set_updated_at on public.curbside_consult_threads;
create trigger curbside_consult_threads_set_updated_at
  before update on public.curbside_consult_threads
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Forge-proofing: thread creation. Never trust client-supplied
-- initiator_clinical_staff_id/organisation_id — always derive from the
-- caller's own active, non-Care-Coordinator clinical_staff row. Validates
-- the recipient the same way. This runs even on a hypothetical direct table
-- INSERT (not just through the RPC below), so it is the real enforcement
-- boundary, not the RPC's own checks.
-- ---------------------------------------------------------------------------
create or replace function private.enforce_curbside_consult_thread()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_initiator_id uuid;
  v_initiator_org uuid;
  v_initiator_tier public.doctor_tier;
  v_recipient_org uuid;
  v_recipient_tier public.doctor_tier;
  v_recipient_active boolean;
  v_recipient_profile uuid;
  v_patient_org uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select id, organisation_id, doctor_tier
    into v_initiator_id, v_initiator_org, v_initiator_tier
    from public.clinical_staff
    where profile_id = v_uid and active
    limit 1;

  if v_initiator_id is null then
    raise exception 'only active clinical staff may start a curbside consult';
  end if;
  if v_initiator_tier is null or v_initiator_tier = 'care_coordinator' then
    raise exception 'curbside consult is a doctor-to-doctor channel, not available to this role';
  end if;

  select organisation_id, doctor_tier, active, profile_id
    into v_recipient_org, v_recipient_tier, v_recipient_active, v_recipient_profile
    from public.clinical_staff
    where id = new.recipient_clinical_staff_id;

  if v_recipient_org is null then
    raise exception 'recipient clinician not found';
  end if;
  if v_recipient_org is distinct from v_initiator_org then
    raise exception 'recipient must be in the same organisation';
  end if;
  if not v_recipient_active then
    raise exception 'recipient clinician is not active';
  end if;
  if v_recipient_tier is null or v_recipient_tier = 'care_coordinator' then
    raise exception 'curbside consult is a doctor-to-doctor channel, recipient must be a doctor tier';
  end if;
  if v_recipient_profile is null then
    raise exception 'recipient has no platform login to receive a consult';
  end if;
  if new.recipient_clinical_staff_id = v_initiator_id then
    raise exception 'cannot start a curbside consult with yourself';
  end if;

  if new.patient_id is not null then
    select organisation_id into v_patient_org from public.profiles where id = new.patient_id;
    if v_patient_org is distinct from v_initiator_org then
      raise exception 'referenced patient must be in the same organisation';
    end if;
  end if;

  if length(coalesce(trim(new.subject), '')) = 0 then
    raise exception 'subject required';
  end if;

  new.organisation_id := v_initiator_org;
  new.initiator_clinical_staff_id := v_initiator_id;
  new.status := 'open';
  new.last_message_sender_id := null;
  new.closed_at := null;
  new.closed_by := null;
  return new;
end;
$$;

drop trigger if exists curbside_consult_threads_enforce_insert on public.curbside_consult_threads;
create trigger curbside_consult_threads_enforce_insert
  before insert on public.curbside_consult_threads
  for each row execute function private.enforce_curbside_consult_thread();

-- Update path: only status may move open -> closed (never reopened here —
-- start a new consult instead, same "closed is terminal" shape as
-- care_message_threads), and closed_at/closed_by are always self-derived
-- from the caller, never client-supplied.
create or replace function private.enforce_curbside_consult_thread_update()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_caller_staff_id uuid;
begin
  if new.organisation_id is distinct from old.organisation_id
    or new.initiator_clinical_staff_id is distinct from old.initiator_clinical_staff_id
    or new.recipient_clinical_staff_id is distinct from old.recipient_clinical_staff_id
    or new.patient_id is distinct from old.patient_id
    or new.subject is distinct from old.subject
    or new.created_at is distinct from old.created_at
  then
    raise exception 'this field cannot be changed after the consult is created';
  end if;

  v_caller_staff_id := private.timeline_staff_from_profile(v_uid, old.organisation_id);
  if v_caller_staff_id is null
    or v_caller_staff_id not in (old.initiator_clinical_staff_id, old.recipient_clinical_staff_id)
  then
    raise exception 'not authorised';
  end if;

  if old.status = 'closed' and new.status is distinct from old.status then
    raise exception 'a closed curbside consult cannot be reopened — start a new one instead';
  end if;

  if new.status = 'closed' and old.status is distinct from new.status then
    new.closed_at := now();
    new.closed_by := v_caller_staff_id;
  else
    new.closed_at := old.closed_at;
    new.closed_by := old.closed_by;
  end if;

  -- Deliberately NOT resetting last_message_at/last_message_sender_id back
  -- to old.* here: private.after_curbside_consult_message_insert() (below)
  -- legitimately updates exactly those two columns after every message, and
  -- this same trigger fires on that update too — resetting them
  -- unconditionally would silently discard that bump. A participant could in
  -- theory UPDATE those two columns directly on their own thread via a raw
  -- PostgREST call, but that's cosmetic tampering with a thread they're
  -- already a party to, not a security or cross-tenant exposure, so it's not
  -- worth the complexity of distinguishing "trigger-driven" from
  -- "client-driven" updates here.
  return new;
end;
$$;

drop trigger if exists curbside_consult_threads_enforce_update on public.curbside_consult_threads;
create trigger curbside_consult_threads_enforce_update
  before update on public.curbside_consult_threads
  for each row execute function private.enforce_curbside_consult_thread_update();

-- Server-derive message author identity and enforce thread membership +
-- open status, exactly private.enforce_care_message_author's shape.
create or replace function private.enforce_curbside_consult_message_author()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid;
  v_initiator uuid;
  v_recipient uuid;
  v_status public.curbside_consult_status;
  v_sender uuid;
begin
  select organisation_id, initiator_clinical_staff_id, recipient_clinical_staff_id, status
    into v_org, v_initiator, v_recipient, v_status
    from public.curbside_consult_threads where id = new.thread_id;

  if v_org is null then
    raise exception 'thread not found';
  end if;
  if v_status = 'closed' then
    raise exception 'this curbside consult is closed';
  end if;

  v_sender := private.timeline_staff_from_profile(v_uid, v_org);
  if v_sender is null or v_sender not in (v_initiator, v_recipient) then
    raise exception 'not authorised';
  end if;
  if length(coalesce(trim(new.body), '')) = 0 then
    raise exception 'message required';
  end if;

  new.organisation_id := v_org;
  new.sender_clinical_staff_id := v_sender;
  return new;
end;
$$;

drop trigger if exists curbside_consult_messages_enforce_author on public.curbside_consult_messages;
create trigger curbside_consult_messages_enforce_author
  before insert on public.curbside_consult_messages
  for each row execute function private.enforce_curbside_consult_message_author();

-- After a message lands: bump the thread + notify whichever participant did
-- NOT send it (the other party is, by definition, the one waiting to hear
-- back). in_app only — see header.
create or replace function private.after_curbside_consult_message_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_initiator uuid;
  v_recipient uuid;
  v_initiator_profile uuid;
  v_recipient_profile uuid;
  v_subject text;
  v_patient_id uuid;
  v_notify_profile uuid;
begin
  update public.curbside_consult_threads
    set last_message_at = new.created_at,
        last_message_sender_id = new.sender_clinical_staff_id,
        updated_at = now()
    where id = new.thread_id
    returning initiator_clinical_staff_id, recipient_clinical_staff_id, subject, patient_id
    into v_initiator, v_recipient, v_subject, v_patient_id;

  select profile_id into v_initiator_profile from public.clinical_staff where id = v_initiator;
  select profile_id into v_recipient_profile from public.clinical_staff where id = v_recipient;

  v_notify_profile := case
    when new.sender_clinical_staff_id = v_initiator then v_recipient_profile
    else v_initiator_profile
  end;

  if v_notify_profile is not null then
    insert into public.notifications
      (organisation_id, recipient_id, channel, status, template, payload)
    values (
      new.organisation_id, v_notify_profile, 'in_app', 'pending', 'curbside_consult_new_message',
      jsonb_build_object(
        'thread_id', new.thread_id::text,
        'subject', v_subject,
        'sender_clinical_staff_id', new.sender_clinical_staff_id::text,
        'patient_id', v_patient_id::text
      )
    );
  end if;

  return new;
end;
$$;

drop trigger if exists curbside_consult_messages_after_insert on public.curbside_consult_messages;
create trigger curbside_consult_messages_after_insert
  after insert on public.curbside_consult_messages
  for each row execute function private.after_curbside_consult_message_insert();

-- RLS -------------------------------------------------------------------
alter table public.curbside_consult_threads enable row level security;
alter table public.curbside_consult_messages enable row level security;

drop policy if exists curbside_consult_threads_select on public.curbside_consult_threads;
create policy curbside_consult_threads_select on public.curbside_consult_threads
  for select to authenticated
  using (
    private.timeline_staff_from_profile((select auth.uid()), organisation_id)
      in (initiator_clinical_staff_id, recipient_clinical_staff_id)
  );

drop policy if exists curbside_consult_threads_insert on public.curbside_consult_threads;
create policy curbside_consult_threads_insert on public.curbside_consult_threads
  for insert to authenticated
  with check (private.is_org_staff(organisation_id));

drop policy if exists curbside_consult_threads_update on public.curbside_consult_threads;
create policy curbside_consult_threads_update on public.curbside_consult_threads
  for update to authenticated
  using (
    private.timeline_staff_from_profile((select auth.uid()), organisation_id)
      in (initiator_clinical_staff_id, recipient_clinical_staff_id)
  )
  with check (
    private.timeline_staff_from_profile((select auth.uid()), organisation_id)
      in (initiator_clinical_staff_id, recipient_clinical_staff_id)
  );

drop policy if exists curbside_consult_messages_select on public.curbside_consult_messages;
create policy curbside_consult_messages_select on public.curbside_consult_messages
  for select to authenticated
  using (
    exists (
      select 1 from public.curbside_consult_threads t
      where t.id = thread_id
        and private.timeline_staff_from_profile((select auth.uid()), t.organisation_id)
          in (t.initiator_clinical_staff_id, t.recipient_clinical_staff_id)
    )
  );

-- Insert is gated to the thread's participants; the BEFORE trigger
-- overwrites organisation_id/sender_clinical_staff_id, so a forged value
-- can't stick.
drop policy if exists curbside_consult_messages_insert on public.curbside_consult_messages;
create policy curbside_consult_messages_insert on public.curbside_consult_messages
  for insert to authenticated
  with check (
    exists (
      select 1 from public.curbside_consult_threads t
      where t.id = thread_id
        and private.timeline_staff_from_profile((select auth.uid()), t.organisation_id)
          in (t.initiator_clinical_staff_id, t.recipient_clinical_staff_id)
    )
  );

-- Append-only: no update/delete policy, no update/delete grant on messages.
grant select, insert, update on public.curbside_consult_threads to authenticated;
grant select, insert on public.curbside_consult_messages to authenticated;

-- ---------------------------------------------------------------------------
-- RPCs — ergonomic, forge-proof entry points, same pattern as
-- start_care_thread/post_care_message. Both SECURITY DEFINER; the BEFORE
-- triggers above are still the real authorisation boundary.
-- ---------------------------------------------------------------------------
create or replace function public.start_curbside_consult(
  p_recipient_clinical_staff_id uuid,
  p_subject text,
  p_body text,
  p_patient_id uuid default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_thread_id uuid;
begin
  if (select auth.uid()) is null then raise exception 'not authenticated'; end if;
  if length(coalesce(trim(p_body), '')) = 0 then raise exception 'message required'; end if;

  insert into public.curbside_consult_threads
    (organisation_id, initiator_clinical_staff_id, recipient_clinical_staff_id, subject, patient_id)
  values (
    -- organisation_id/initiator_clinical_staff_id are overwritten by the
    -- BEFORE INSERT trigger; placeholders here only satisfy NOT NULL.
    '00000000-0000-0000-0000-000000000000', p_recipient_clinical_staff_id, p_recipient_clinical_staff_id,
    trim(p_subject), p_patient_id
  )
  returning id into v_thread_id;

  insert into public.curbside_consult_messages (thread_id, body) values (v_thread_id, trim(p_body));
  return v_thread_id;
end;
$$;

create or replace function public.post_curbside_consult_message(
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
  -- derives sender/organisation; it raises if the caller may not post.
  insert into public.curbside_consult_messages (thread_id, body) values (p_thread_id, trim(p_body))
  returning id into v_message_id;
  return v_message_id;
end;
$$;

create or replace function public.close_curbside_consult(p_thread_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise exception 'not authenticated'; end if;
  -- The BEFORE UPDATE trigger validates participation and derives
  -- closed_at/closed_by; it raises if the caller may not close it.
  update public.curbside_consult_threads set status = 'closed' where id = p_thread_id;
  if not found then
    raise exception 'consult not found or not authorised';
  end if;
end;
$$;

revoke execute on function public.start_curbside_consult(uuid, text, text, uuid) from public, anon;
revoke execute on function public.post_curbside_consult_message(uuid, text) from public, anon;
revoke execute on function public.close_curbside_consult(uuid) from public, anon;
grant execute on function public.start_curbside_consult(uuid, text, text, uuid) to authenticated;
grant execute on function public.post_curbside_consult_message(uuid, text) to authenticated;
grant execute on function public.close_curbside_consult(uuid) to authenticated;

-- "Awaiting my reply" count for the clinician nav badge / pending-jobs
-- banner — same shape and same reasoning as
-- count_care_threads_awaiting_reply (20260917090629): a column-vs-caller
-- comparison PostgREST's filter syntax can't express directly. security
-- invoker: RLS on curbside_consult_threads already scopes to the caller's
-- own threads, so invoker mode gets the right per-caller count for free.
create or replace function public.count_curbside_consults_awaiting_reply()
returns integer
language sql stable security invoker set search_path = '' as $$
  select count(*)::int
  from public.curbside_consult_threads t
  where t.status = 'open'
    and t.last_message_sender_id is not null
    and t.last_message_sender_id <> private.timeline_staff_from_profile((select auth.uid()), t.organisation_id);
$$;

grant execute on function public.count_curbside_consults_awaiting_reply() to authenticated;

do $$
begin
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'curbside_consult_threads') then
    raise exception 'curbside_consult_threads was not created';
  end if;
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'curbside_consult_messages') then
    raise exception 'curbside_consult_messages was not created';
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'curbside_consult_threads' and policyname = 'curbside_consult_threads_select'
  ) then
    raise exception 'curbside_consult_threads_select policy missing';
  end if;
  if has_function_privilege('anon', 'public.start_curbside_consult(uuid, text, text, uuid)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute start_curbside_consult';
  end if;
  if has_function_privilege('anon', 'public.post_curbside_consult_message(uuid, text)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute post_curbside_consult_message';
  end if;
  if has_function_privilege('anon', 'public.close_curbside_consult(uuid)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute close_curbside_consult';
  end if;
  if not has_table_privilege('authenticated', 'public.curbside_consult_threads', 'INSERT') then
    raise exception 'FAIL: authenticated cannot insert curbside_consult_threads (grants gotcha)';
  end if;
  if not has_table_privilege('authenticated', 'public.curbside_consult_messages', 'INSERT') then
    raise exception 'FAIL: authenticated cannot insert curbside_consult_messages (grants gotcha)';
  end if;
end $$;
