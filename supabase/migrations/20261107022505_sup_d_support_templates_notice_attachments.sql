-- Customer Support Dashboard, phase D: reply templates, a notice when support replies, and ticket attachments (SUP-2,
-- docs/design/SUPPORT-DASHBOARD.md section 5).
--
-- 1. support_response_templates: approved wording an agent can start a reply from. Wording is data with a human gate (the
--    FD-5 rule): a template is created as draft, a support lead approves that exact text, and editing approved text returns
--    it to draft. Agents see approved templates only. A template is a starting point; the agent still reads and sends.
--
-- 2. A patient-visible staff reply on a technical ticket now leaves an in-app notice ("Your support team replied"). Until
--    now nothing told the patient (help requests and care messages already notify). The notice carries no reply text:
--    in-app only, non-clinical, a link to the ticket (INV-07; two-way conversation stays in the app).
--
-- 3. support_ticket_attachments: a file on a ticket, scanned before it is stored (T2-08 ClamAV, the same verdict table the
--    clinical document intake uses; apps/web/src/lib/support/attachments.ts). The bucket is private and has no client
--    policy: files are written by the server after the scan and read only through a short-lived signed link handed out
--    after this table's RLS has allowed the row. A file the scanner could not check is kept but held (no link) until a
--    rescan; an infected file is never stored.
--    If a customer attaches a clinical document by mistake, a support lead can restrict it (reason required): it disappears
--    from the support queue, the customer still sees their own upload, and the row is kept for the audit trail. The lead
--    is told in the UI to pass it to the care team through the clinical document upload, not to forward the file.

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. Reply templates
-- ---------------------------------------------------------------------------------------------------------------------
create table public.support_response_templates (
  id           uuid primary key default gen_random_uuid(),
  title        text not null check (length(btrim(title)) between 3 and 120),
  body         text not null check (length(btrim(body)) between 10 and 4000),
  category     text check (category is null or category in (
                 'acknowledgement', 'more_information', 'assignment', 'investigation_update', 'escalation',
                 'payment', 'membership', 'resolution', 'closure', 'feedback_request', 'other')),
  status       text not null default 'draft' check (status in ('draft', 'approved', 'retired')),
  version      integer not null default 1 check (version >= 1),
  created_by   uuid not null references public.profiles(id) on delete restrict,
  approved_by  uuid references public.profiles(id) on delete restrict,
  approved_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check (status <> 'approved' or (approved_by is not null and approved_at is not null))
);

comment on table public.support_response_templates is
  'Support desk reply templates. Draft until a support lead approves the exact text; editing approved text returns it to draft (FD-5 pattern). Must never carry clinical advice.';

-- Editing the words of an approved template sends it back to draft and bumps the version; approval is only ever set by
-- approve_support_response_template.
create or replace function private.support_response_templates_guard()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  if tg_op = 'INSERT' then
    new.status := 'draft';
    new.approved_by := null;
    new.approved_at := null;
    new.version := 1;
    new.created_by := coalesce((select auth.uid()), new.created_by);
    return new;
  end if;

  if (new.body is distinct from old.body or new.title is distinct from old.title) then
    new.status := 'draft';
    new.approved_by := null;
    new.approved_at := null;
    new.version := old.version + 1;
  elsif new.status = 'approved' and old.status <> 'approved'
        and coalesce(current_setting('tarragon.support_template_approve', true), '') <> 'on' then
    raise exception 'Approve a template with approve_support_response_template' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger support_response_templates_guard
  before insert or update on public.support_response_templates
  for each row execute function private.support_response_templates_guard();

alter table public.support_response_templates enable row level security;

create policy support_response_templates_read on public.support_response_templates
  for select to authenticated
  using ((select private.is_support_lead()) or ((select private.is_support_staff()) and status = 'approved'));
create policy support_response_templates_lead_insert on public.support_response_templates
  for insert to authenticated with check ((select private.is_support_lead()));
create policy support_response_templates_lead_update on public.support_response_templates
  for update to authenticated
  using ((select private.is_support_lead())) with check ((select private.is_support_lead()));
-- No delete: retire instead, so a sent reply's starting text stays traceable.

grant select, insert, update on public.support_response_templates to authenticated;
revoke all on public.support_response_templates from anon;

create or replace function public.approve_support_response_template(p_template_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_rows integer;
begin
  if not private.is_support_lead() then
    raise exception 'Only a support lead can approve a reply template' using errcode = '42501';
  end if;
  perform set_config('tarragon.support_template_approve', 'on', true);
  update public.support_response_templates
     set status = 'approved', approved_by = (select auth.uid()), approved_at = now()
   where id = p_template_id and status = 'draft';
  get diagnostics v_rows = row_count;
  perform set_config('tarragon.support_template_approve', '', true);
  if v_rows = 0 then
    raise exception 'Only a draft template can be approved' using errcode = '22023';
  end if;
end;
$$;

revoke all on function public.approve_support_response_template(uuid) from public, anon;
grant execute on function public.approve_support_response_template(uuid) to authenticated;

do $$
begin
  if to_regproc('private.audit_row_change') is not null then
    execute 'create trigger support_response_templates_audit after insert or update or delete on public.support_response_templates for each row execute function private.audit_row_change()';
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. Notice to the patient when support replies on a ticket
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function private.support_ticket_reply_notice()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_patient uuid;
begin
  if new.author_role <> 'staff' or coalesce(new.is_internal, false) then
    return new;
  end if;
  select t.patient_id into v_patient from public.support_tickets t where t.id = new.ticket_id;
  if v_patient is null then
    return new;
  end if;
  insert into public.notifications
    (organisation_id, recipient_id, channel, status, template, content_class, payload, source_table, source_id)
  values
    (new.organisation_id, v_patient, 'in_app', 'pending', 'support_ticket_reply',
     'non_clinical'::public.notification_content_class,
     jsonb_build_object('ticket_id', new.ticket_id::text),
     'support_ticket_comments', new.id);
  return new;
end;
$$;

create trigger support_ticket_comments_reply_notice
  after insert on public.support_ticket_comments
  for each row execute function private.support_ticket_reply_notice();

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. Ticket attachments
-- ---------------------------------------------------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('support-attachments', 'support-attachments', false, 10485760,
        array['image/png', 'image/jpeg', 'image/webp', 'application/pdf', 'text/plain'])
on conflict (id) do nothing;
-- Deliberately no storage.objects policy for this bucket: only the service role writes and signs.

create table public.support_ticket_attachments (
  id                 uuid primary key default gen_random_uuid(),
  organisation_id    uuid not null references public.organisations(id) on delete restrict,
  ticket_id          uuid not null references public.support_tickets(id) on delete restrict,
  storage_path       text not null unique,
  file_name          text not null check (length(file_name) between 1 and 200),
  mime_type          text not null,
  size_bytes         bigint not null check (size_bytes > 0 and size_bytes <= 10485760),
  content_sha256     text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  scan_status        text not null check (scan_status in ('clean', 'pending_scan', 'unscanned')),
  uploaded_by        uuid not null references public.profiles(id) on delete restrict,
  uploader_role      text not null check (uploader_role in ('patient', 'staff')),
  is_internal        boolean not null default false,
  restricted_at      timestamptz,
  restricted_by      uuid references public.profiles(id) on delete restrict,
  restricted_reason  text,
  created_at         timestamptz not null default now(),
  check (uploader_role = 'staff' or not is_internal),
  check (restricted_at is null or (restricted_by is not null and length(btrim(coalesce(restricted_reason, ''))) >= 10))
);

create index support_ticket_attachments_ticket_idx on public.support_ticket_attachments (ticket_id);

comment on table public.support_ticket_attachments is
  'Files on a support ticket. Scanned before storage (T2-08); private bucket, no client storage policy, short-lived signed links only after this row''s RLS allows it. A lead can restrict a clinical document attached by mistake.';

alter table public.support_ticket_attachments enable row level security;

create policy support_ticket_attachments_read on public.support_ticket_attachments
  for select to authenticated
  using (
    -- the patient sees their ticket's customer-visible files, including their own restricted upload
    (not is_internal and exists (select 1 from public.support_tickets t where t.id = ticket_id and t.patient_id = (select auth.uid())))
    -- staff see the ticket's files unless restricted; a support lead or super admin still sees a restricted one
    or (private.is_org_staff(organisation_id) and (restricted_at is null or (select private.is_support_lead())))
  );
-- Rows are written by the server (service role) after the scan; restriction goes through the RPC below.

grant select on public.support_ticket_attachments to authenticated;
revoke all on public.support_ticket_attachments from anon;

do $$
begin
  if to_regproc('private.audit_row_change') is not null then
    execute 'create trigger support_ticket_attachments_audit after insert or update or delete on public.support_ticket_attachments for each row execute function private.audit_row_change()';
  end if;
end $$;

create or replace function public.restrict_support_attachment(p_attachment_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path to ''
as $$
begin
  if not private.is_support_lead() then
    raise exception 'Only a support lead can restrict an attachment' using errcode = '42501';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 10 then
    raise exception 'Say why the file is being restricted (at least 10 characters)' using errcode = '22023';
  end if;
  update public.support_ticket_attachments
     set restricted_at = now(), restricted_by = (select auth.uid()), restricted_reason = btrim(p_reason)
   where id = p_attachment_id and restricted_at is null;
  if not found then
    raise exception 'That attachment was not found or is already restricted' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.restrict_support_attachment(uuid, text) from public, anon;
grant execute on function public.restrict_support_attachment(uuid, text) to authenticated;

do $$
begin
  if has_table_privilege('anon', 'public.support_ticket_attachments', 'SELECT')
     or has_table_privilege('anon', 'public.support_response_templates', 'SELECT') then
    raise exception 'anon must not read support attachments or templates';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
              and (coalesce(qual, '') || coalesce(with_check, '')) like '%support-attachments%') then
    raise exception 'support-attachments must have no client storage policy';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'support_ticket_comments_reply_notice') then
    raise exception 'reply notice trigger missing';
  end if;
end $$;
