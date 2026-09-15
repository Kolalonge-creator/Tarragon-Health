-- Tarragon Health — clinical note templates / smart phrases (Care Team /
-- Provider Workspace §5.8).
--
-- Confirmed by a whole-repo grep before writing this: zero existing
-- templating/snippet/canned-text infrastructure anywhere in apps/web/src —
-- not in clinical notes, not in message composition, nowhere. This is new
-- schema, not an extension.
--
-- Deliberately simple: one flat, org-shared, clinician-authored table of
-- reusable text snippets ("templates" and "smart phrases" collapsed into one
-- mechanism — the spec draws a line between a longer template and a short
-- phrase, but both are just "reusable named text a clinician inserts",
-- so a second table/type distinction would be a difference in body length,
-- not in kind). No approval workflow, no per-user private templates: any
-- org staff can create one and every org staff can use it, same trust model
-- as the rest of the clinical-core content this org already shares (unlike
-- protocol_versions, which genuinely needs Clinical Director sign-off —
-- a note template is convenience text, not a clinical instruction).

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

-- Any org staff may delete a shared template, same "team-owned, not
-- author-owned" model as the select/update policies above — a stale
-- template left by someone who moved on shouldn't need that specific
-- person to come back and remove it.
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
