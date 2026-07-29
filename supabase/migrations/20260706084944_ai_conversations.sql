-- Tarragon Health — V1 consumer spec reconciliation (Phase 0)
-- 07 · ai_conversations — AI Health Coach scaffold
--
-- Schema only. The LangGraph.js + Claude API wiring, disclaimer/guardrail
-- logic, and chat UI are a separate future phase — this migration just
-- reserves storage for per-profile conversation history so that phase has
-- somewhere to write to.

create table public.ai_conversations (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  profile_id        uuid not null references public.profiles (id) on delete cascade,
  messages          jsonb not null default '[]'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index ai_conversations_profile_idx on public.ai_conversations (profile_id, updated_at desc);
create index ai_conversations_org_idx on public.ai_conversations (organisation_id);

create trigger ai_conversations_set_updated_at
  before update on public.ai_conversations
  for each row execute function private.set_updated_at();

alter table public.ai_conversations enable row level security;

-- Patient owns their own conversation; staff can read (support/audit) but
-- not write — the chat itself is written by the app/service on the
-- patient's behalf in the future AI Coach phase, not by staff.
create policy ai_conversations_select on public.ai_conversations
  for select to authenticated
  using (profile_id = (select auth.uid()) or private.is_org_staff(organisation_id));
create policy ai_conversations_insert on public.ai_conversations
  for insert to authenticated
  with check (profile_id = (select auth.uid()));
create policy ai_conversations_update on public.ai_conversations
  for update to authenticated
  using (profile_id = (select auth.uid()))
  with check (profile_id = (select auth.uid()));
create policy ai_conversations_delete on public.ai_conversations
  for delete to authenticated
  using (profile_id = (select auth.uid()) or private.is_org_staff(organisation_id));

grant select, insert, update, delete on public.ai_conversations to authenticated;
