-- Tarragon Health — clinical note templates / smart phrases (Care Team /
-- Provider Workspace §5.8). Committed to git but never actually applied to
-- production — found and fixed alongside my_provider_performance_rpc.
-- Content below is byte-identical to the committed
-- 20260827205008_note_templates.sql.

create table if not exists public.note_templates (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  created_by      uuid references public.profiles (id) on delete set null,
  title           text not null,
  body            text not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint note_templates_title_length check (char_length(title) between 1 and 100),
  constraint note_templates_body_length check (char_length(body) between 1 and 2000)
);

create index if not exists note_templates_org_idx on public.note_templates (organisation_id, title);

drop trigger if exists note_templates_set_updated_at on public.note_templates;
create trigger note_templates_set_updated_at
  before update on public.note_templates
  for each row execute function private.set_updated_at();

alter table public.note_templates enable row level security;

drop policy if exists note_templates_select on public.note_templates;
create policy note_templates_select on public.note_templates
  for select to authenticated
  using (private.is_org_staff(organisation_id));

drop policy if exists note_templates_insert on public.note_templates;
create policy note_templates_insert on public.note_templates
  for insert to authenticated
  with check (private.is_org_staff(organisation_id) and created_by = (select auth.uid()));

drop policy if exists note_templates_update on public.note_templates;
create policy note_templates_update on public.note_templates
  for update to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

drop policy if exists note_templates_delete on public.note_templates;
create policy note_templates_delete on public.note_templates
  for delete to authenticated
  using (private.is_org_staff(organisation_id));

grant select, insert, update, delete on public.note_templates to authenticated;

do $$
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'note_templates'
  ) then
    raise exception 'note_templates table was not created';
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'note_templates' and cmd = 'SELECT'
  ) then
    raise exception 'note_templates has no SELECT policy';
  end if;
end $$;
