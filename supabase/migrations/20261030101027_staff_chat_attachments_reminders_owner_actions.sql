-- Staff-to-patient chat: staff attachments, patient reminders, conversation owner, message actions.
-- No existing function is redefined here (after_care_message_insert, post_care_message and the
-- can_read_clinical overloads are all untouched), so no call site can change meaning.
--
-- PROPOSED values (not yet signed off, tune before go-live): first reminder after 24 hours unread,
-- second after 72 hours, never more than two per message, only 08:00-20:00 Africa/Lagos.

-- 1. Staff may attach files to a patient's thread ----------------------------------------------
-- The bucket's insert policy only admitted the patient's own folder. A staff member uploads into the
-- patient's folder (the path every reader already expects), and only for a patient in their organisation.
create or replace function private.staff_may_upload_to_patient_folder(p_folder text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
     where p.id::text = p_folder and p.organisation_id is not null and private.is_org_staff(p.organisation_id)
  );
$$;
revoke all on function private.staff_may_upload_to_patient_folder(text) from public, anon;
grant execute on function private.staff_may_upload_to_patient_folder(text) to authenticated;

drop policy if exists "care message attachment staff insert" on storage.objects;
create policy "care message attachment staff insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'care-message-attachments'
    and private.staff_may_upload_to_patient_folder((storage.foldername(name))[1])
  );

-- Since the audited inbox (S22e) staff cannot read message rows directly, so a policy that looks the message up
-- through its own row security would refuse the very author. This asks the question with definer rights instead.
create or replace function private.is_own_care_message(p_message uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.care_messages m where m.id = p_message and m.author_profile_id = (select auth.uid()));
$$;
revoke all on function private.is_own_care_message(uuid) from public, anon;
grant execute on function private.is_own_care_message(uuid) to authenticated;

drop policy if exists care_message_attachments_insert on public.care_message_attachments;
create policy care_message_attachments_insert on public.care_message_attachments
  for insert to authenticated with check (private.is_own_care_message(message_id));

-- 2. Reminder when a patient has not opened a care-team message --------------------------------
alter table public.care_message_threads
  add column if not exists patient_reminder_count smallint not null default 0,
  add column if not exists patient_last_reminded_at timestamptz;

-- A new message of either kind starts a fresh reminder cycle.
create or replace function private.reset_care_message_reminders()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.care_message_threads
     set patient_reminder_count = 0, patient_last_reminded_at = null
   where id = new.thread_id and (patient_reminder_count <> 0 or patient_last_reminded_at is not null);
  return new;
end $$;
revoke all on function private.reset_care_message_reminders() from public, anon;

drop trigger if exists care_messages_reset_reminders on public.care_messages;
create trigger care_messages_reset_reminders
  after insert on public.care_messages
  for each row execute function private.reset_care_message_reminders();

-- The nudge says only that a message is waiting (content_class non_clinical), so it is safe on push and email.
create or replace function private.remind_patients_of_unread_care_messages(
  p_first interval default interval '24 hours',
  p_gap interval default interval '48 hours',
  p_max smallint default 2,
  p_now timestamptz default now(),
  p_include_test boolean default false
) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  v_sent integer := 0;
  v_hour integer := extract(hour from (p_now at time zone 'Africa/Lagos'))::integer;
begin
  if v_hour < 8 or v_hour >= 20 then return 0; end if;
  for r in
    select t.id, t.organisation_id, t.patient_id, t.patient_reminder_count
      from public.care_message_threads t
      join public.profiles pr on pr.id = t.patient_id
     where t.status = 'open'
       and (p_include_test or not pr.is_test)
       and t.last_message_author_role = 'care_team'
       and (t.patient_last_read_at is null or t.patient_last_read_at < t.last_message_at)
       and t.patient_reminder_count < p_max
       and p_now - t.last_message_at >= p_first
       and (t.patient_last_reminded_at is null or p_now - t.patient_last_reminded_at >= p_gap)
     order by t.last_message_at
     limit 500
  loop
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload, content_class)
    values (r.organisation_id, r.patient_id, private.patient_reminder_channel(r.patient_id), 'pending',
            'care_message_reminder', jsonb_build_object('thread_id', r.id::text, 'reminder_no', r.patient_reminder_count + 1),
            'non_clinical');
    -- Setting the count and time in the same statement as the insert is what stops a second sweep repeating it.
    update public.care_message_threads
       set patient_reminder_count = r.patient_reminder_count + 1, patient_last_reminded_at = p_now
     where id = r.id;
    v_sent := v_sent + 1;
  end loop;
  return v_sent;
end $$;
revoke all on function private.remind_patients_of_unread_care_messages(interval, interval, smallint, timestamptz, boolean) from public, anon, authenticated;

do $$ begin
  if exists (select 1 from cron.job where jobname = 'remind-patients-unread-care-messages') then
    perform cron.unschedule('remind-patients-unread-care-messages');
  end if;
end $$;
select cron.schedule('remind-patients-unread-care-messages', '17 * * * *',
  $$ select private.remind_patients_of_unread_care_messages(); $$);

-- 3. Conversation owner and hand-over note (staff only; the thread row itself is patient-readable) --
create table if not exists public.care_thread_owners (
  thread_id       uuid primary key references public.care_message_threads (id) on delete cascade,
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  owner_id        uuid not null references public.profiles (id) on delete restrict,
  assigned_by     uuid references public.profiles (id) on delete set null,
  assigned_at     timestamptz not null default now(),
  handover_note   text check (handover_note is null or length(handover_note) <= 2000)
);
create index if not exists care_thread_owners_owner_idx on public.care_thread_owners (owner_id);

create or replace function private.enforce_care_thread_owner()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
  v_uid uuid := (select auth.uid());
begin
  select organisation_id into v_org from public.care_message_threads where id = new.thread_id;
  if v_org is null then raise exception 'thread not found'; end if;
  if not private.is_org_staff(v_org) then raise exception 'not authorised' using errcode = '42501'; end if;
  if not exists (
    select 1 from public.profiles p
     where p.id = new.owner_id and p.organisation_id = v_org and p.is_active
       and p.role in ('clinician', 'care_coordinator', 'admin')
  ) then
    raise exception 'owner must be active staff in the same organisation';
  end if;
  new.organisation_id := v_org;
  new.assigned_by := v_uid;
  new.assigned_at := now();
  return new;
end $$;
revoke all on function private.enforce_care_thread_owner() from public, anon;

-- Every change of owner is kept (append-only; written by the trigger below, never by a client).
create table if not exists public.care_thread_owner_events (
  id              uuid primary key default gen_random_uuid(),
  thread_id       uuid not null references public.care_message_threads (id) on delete cascade,
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  from_owner_id   uuid references public.profiles (id) on delete set null,
  to_owner_id     uuid references public.profiles (id) on delete set null,
  changed_by      uuid references public.profiles (id) on delete set null,
  handover_note   text,
  created_at      timestamptz not null default now()
);
create index if not exists care_thread_owner_events_thread_idx on public.care_thread_owner_events (thread_id, created_at);
alter table public.care_thread_owner_events enable row level security;
drop policy if exists care_thread_owner_events_staff_select on public.care_thread_owner_events;
create policy care_thread_owner_events_staff_select on public.care_thread_owner_events
  for select to authenticated using (private.is_org_staff(organisation_id));
grant select on public.care_thread_owner_events to authenticated;

create or replace function private.log_care_thread_owner_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.owner_id is distinct from old.owner_id then
    insert into public.care_thread_owner_events (thread_id, organisation_id, from_owner_id, to_owner_id, changed_by, handover_note)
    values (new.thread_id, new.organisation_id, case when tg_op = 'UPDATE' then old.owner_id end, new.owner_id, new.assigned_by, new.handover_note);
  end if;
  return new;
end $$;
revoke all on function private.log_care_thread_owner_change() from public, anon;

drop trigger if exists care_thread_owners_log on public.care_thread_owners;
create trigger care_thread_owners_log
  after insert or update on public.care_thread_owners
  for each row execute function private.log_care_thread_owner_change();

drop trigger if exists care_thread_owners_enforce on public.care_thread_owners;
create trigger care_thread_owners_enforce
  before insert or update on public.care_thread_owners
  for each row execute function private.enforce_care_thread_owner();

alter table public.care_thread_owners enable row level security;
drop policy if exists care_thread_owners_staff_select on public.care_thread_owners;
create policy care_thread_owners_staff_select on public.care_thread_owners
  for select to authenticated using (private.is_org_staff(organisation_id));
drop policy if exists care_thread_owners_staff_insert on public.care_thread_owners;
create policy care_thread_owners_staff_insert on public.care_thread_owners
  for insert to authenticated with check (private.is_org_staff(organisation_id));
drop policy if exists care_thread_owners_staff_update on public.care_thread_owners;
create policy care_thread_owners_staff_update on public.care_thread_owners
  for update to authenticated using (private.is_org_staff(organisation_id)) with check (private.is_org_staff(organisation_id));
grant select, insert, update on public.care_thread_owners to authenticated;

-- 4. Action buttons inside a care-team message ---------------------------------------------------
-- A fixed list of in-app destinations (the app maps each kind to its own screen); no free-form URL
-- can be stored, so a message can never carry an outside link.
create table if not exists public.care_message_actions (
  id              uuid primary key default gen_random_uuid(),
  message_id      uuid not null references public.care_messages (id) on delete cascade,
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  patient_id      uuid not null references public.profiles (id) on delete cascade,
  kind            text not null check (kind in ('book_appointment', 'upload_result', 'log_reading', 'review_medications')),
  created_at      timestamptz not null default now(),
  unique (message_id, kind)
);
create index if not exists care_message_actions_message_idx on public.care_message_actions (message_id);

create or replace function private.enforce_care_message_action()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  m record;
begin
  select organisation_id, patient_id, author_profile_id, author_role into m
    from public.care_messages where id = new.message_id;
  if m.organisation_id is null then raise exception 'message not found'; end if;
  if m.author_role <> 'care_team' or m.author_profile_id is distinct from (select auth.uid()) then
    raise exception 'only the care-team author can add an action' using errcode = '42501';
  end if;
  new.organisation_id := m.organisation_id;
  new.patient_id := m.patient_id;
  return new;
end $$;
revoke all on function private.enforce_care_message_action() from public, anon;

drop trigger if exists care_message_actions_enforce on public.care_message_actions;
create trigger care_message_actions_enforce
  before insert on public.care_message_actions
  for each row execute function private.enforce_care_message_action();

alter table public.care_message_actions enable row level security;
-- An action carries no clinical content (a fixed kind), so staff may read it even though they open bodies only through the audited functions.
drop policy if exists care_message_actions_select on public.care_message_actions;
create policy care_message_actions_select on public.care_message_actions
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id, 'messaging'::public.care_access_category)
  );
drop policy if exists care_message_actions_insert on public.care_message_actions;
create policy care_message_actions_insert on public.care_message_actions
  for insert to authenticated
  with check (private.is_own_care_message(message_id));
grant select, insert on public.care_message_actions to authenticated;

-- Every patient-data table is registered for retention/export (data_registry) and for how staff may read it (staff_read_scope).
-- care_message_actions is the same kind of record as its message siblings; reviewed stays false until the CMO and DPO classify it.
insert into public.data_registry (table_name, patient_expr, retention_class, end_of_retention, in_export, reviewed, notes)
values ('care_message_actions', 'patient_id', 'clinical_record', 'review', true, false,
        'Buttons a care-team member attached to a message. Class copied from care_messages; not yet reviewed by the CMO and DPO.')
on conflict (table_name) do nothing;
insert into public.staff_read_scope (table_name, mode, patient_expr, category, reason)
values ('care_message_actions', 'org', 'patient_id', 'medical_history', 'a fixed button kind with no clinical content; read with the thread headers')
on conflict (table_name) do nothing;

-- 5. Assertions ------------------------------------------------------------------------------------
do $$
begin
  if has_function_privilege('anon', 'private.remind_patients_of_unread_care_messages(interval, interval, smallint, timestamptz, boolean)', 'EXECUTE') then
    raise exception 'FAIL: anon can run the reminder sweep';
  end if;
  if has_table_privilege('anon', 'public.care_thread_owners', 'SELECT') or has_table_privilege('anon', 'public.care_message_actions', 'SELECT') then
    raise exception 'FAIL: anon can read the new tables';
  end if;
  if not exists (select 1 from public.data_registry where table_name = 'care_message_actions')
     or not exists (select 1 from public.staff_read_scope where table_name = 'care_message_actions') then
    raise exception 'FAIL: care_message_actions is not registered';
  end if;
  if not exists (select 1 from cron.job where jobname = 'remind-patients-unread-care-messages') then
    raise exception 'FAIL: reminder job not scheduled';
  end if;
end $$;
