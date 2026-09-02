do $$ begin
  if not exists (select 1 from pg_type where typname = 'care_message_template_category') then
    create type public.care_message_template_category as enum (
      'result_communication', 'appointment_follow_up', 'medication_instructions', 'monitoring_reminder', 'general'
    );
  end if;
end $$;

create table public.care_message_templates (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  category        public.care_message_template_category not null default 'general',
  title           text not null,
  body            text not null,
  created_by      uuid references public.profiles (id) on delete set null,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.care_message_templates is
  '77.7 clinician-authored, editable reply templates for composing a care_messages reply. Distinct from notification_templates (20260830002308), which catalogues the SYSTEM''s automated one-way notification copy — nobody selects or edits one of those at send time.';

create index care_message_templates_org_idx
  on public.care_message_templates (organisation_id, category)
  where is_active;

create trigger care_message_templates_set_updated_at
  before update on public.care_message_templates
  for each row execute function private.set_updated_at();

alter table public.care_message_templates enable row level security;

create policy care_message_templates_select on public.care_message_templates
  for select to authenticated
  using (private.is_org_staff(organisation_id));

create policy care_message_templates_insert on public.care_message_templates
  for insert to authenticated
  with check (private.is_org_staff(organisation_id) and organisation_id = private.current_org_id());

create policy care_message_templates_update on public.care_message_templates
  for update to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

grant select, insert, update on public.care_message_templates to authenticated;

create or replace function private.enforce_care_message_template_author()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := (select auth.uid());
  else
    new.created_by := old.created_by;
    new.organisation_id := old.organisation_id;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

drop trigger if exists care_message_templates_enforce_author on public.care_message_templates;
create trigger care_message_templates_enforce_author
  before insert or update on public.care_message_templates
  for each row execute function private.enforce_care_message_template_author();

do $$
begin
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'care_message_templates') then
    raise exception 'FAIL: care_message_templates was not created';
  end if;
  if has_table_privilege('anon', 'public.care_message_templates', 'SELECT') then
    raise exception 'FAIL: anon can read care_message_templates';
  end if;
  raise notice 'PASS: care_message_templates created with org-staff RLS, server-derived created_by, anon denied';
end $$;
