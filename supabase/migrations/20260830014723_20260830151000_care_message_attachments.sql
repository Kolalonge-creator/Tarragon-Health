create table public.care_message_attachments (
  id                 uuid primary key default gen_random_uuid(),
  organisation_id    uuid not null references public.organisations (id) on delete restrict,
  patient_id         uuid not null references public.profiles (id) on delete cascade,
  thread_id          uuid not null references public.care_message_threads (id) on delete cascade,
  message_id         uuid not null references public.care_messages (id) on delete cascade,
  file_path          text not null,
  original_filename  text,
  mime_type          text,
  file_size_bytes    bigint,
  uploaded_by        uuid references public.profiles (id) on delete set null,
  created_at         timestamptz not null default now()
);

comment on table public.care_message_attachments is
  '77.10. Attaches a file to an existing care_messages row. organisation_id/patient_id/thread_id are server-derived from message_id (never client-supplied) by private.enforce_care_message_attachment_scope, so a caller can never attach a file to a message that is not their own / not in a thread they may post to.';

create index care_message_attachments_message_idx
  on public.care_message_attachments (message_id);
create index care_message_attachments_thread_idx
  on public.care_message_attachments (thread_id);

alter table public.care_message_attachments enable row level security;

create policy care_message_attachments_select on public.care_message_attachments
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id)
  );

create policy care_message_attachments_insert on public.care_message_attachments
  for insert to authenticated
  with check (
    exists (
      select 1 from public.care_messages m
      where m.id = message_id
        and m.author_profile_id = (select auth.uid())
    )
  );

grant select, insert on public.care_message_attachments to authenticated;

create or replace function private.enforce_care_message_attachment_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_patient uuid;
  v_thread uuid;
begin
  select organisation_id, patient_id, thread_id
    into v_org, v_patient, v_thread
    from public.care_messages where id = new.message_id;
  if v_org is null then
    raise exception 'message not found';
  end if;

  new.organisation_id := v_org;
  new.patient_id := v_patient;
  new.thread_id := v_thread;
  new.uploaded_by := (select auth.uid());

  return new;
end;
$$;

drop trigger if exists care_message_attachments_enforce_scope on public.care_message_attachments;
create trigger care_message_attachments_enforce_scope
  before insert on public.care_message_attachments
  for each row execute function private.enforce_care_message_attachment_scope();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'care-message-attachments',
  'care-message-attachments',
  false,
  15728640,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']
)
on conflict (id) do nothing;

drop policy if exists "care message attachment patient insert" on storage.objects;
create policy "care message attachment patient insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'care-message-attachments'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "care message attachment patient select" on storage.objects;
create policy "care message attachment patient select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'care-message-attachments'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

do $$
begin
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'care_message_attachments') then
    raise exception 'FAIL: care_message_attachments was not created';
  end if;
  if not exists (select 1 from storage.buckets where id = 'care-message-attachments') then
    raise exception 'FAIL: care-message-attachments bucket was not created';
  end if;
  if has_table_privilege('anon', 'public.care_message_attachments', 'SELECT') then
    raise exception 'FAIL: anon can read care_message_attachments';
  end if;
  raise notice 'PASS: care_message_attachments + private bucket created, forge-proof scope trigger in place, anon denied';
end $$;
