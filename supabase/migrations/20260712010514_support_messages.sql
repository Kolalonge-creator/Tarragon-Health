-- Tarragon Health — WhatsApp support inbox (docs/ARCHITECTURE.md §8)
--
-- Storage for the human-only inbound WhatsApp channel: "whatsapp-webhook does
-- nothing but store the message and surface it in a clinician's support
-- inbox — no intent router, no bot, no parsing into a vitals/medication_logs/
-- booking write. A clinician reads it like a helpdesk ticket and replies
-- from the platform." Never write to this table from anywhere but the
-- whatsapp-webhook Edge Function (service role) — no client-side inserts.

create table public.support_messages (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id),
  patient_id       uuid references public.profiles (id) on delete set null,
  direction        text not null check (direction in ('inbound', 'outbound')),
  from_phone       text not null,
  to_phone         text,
  message_type     text not null default 'text',
  body             text,
  wa_message_id    text unique,
  status           text not null default 'unread' check (status in ('unread', 'read', 'replied')),
  raw_payload      jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index support_messages_organisation_id_idx on public.support_messages (organisation_id);
create index support_messages_patient_id_idx on public.support_messages (patient_id);

create trigger support_messages_set_updated_at
  before update on public.support_messages
  for each row execute function private.set_updated_at();

alter table public.support_messages enable row level security;

-- Org staff triage their org's inbox; admins see all. No insert/delete
-- policies for `authenticated` — every row is written by the Edge Function
-- under the service-role key (bypasses RLS by design, same as
-- abnormal-result-handler's audit_log writes).
create policy support_messages_select on public.support_messages
  for select to authenticated
  using (private.is_admin() or private.is_org_staff(organisation_id));

create policy support_messages_update on public.support_messages
  for update to authenticated
  using (private.is_admin() or private.is_org_staff(organisation_id))
  with check (private.is_admin() or private.is_org_staff(organisation_id));

grant select, update on public.support_messages to authenticated;
