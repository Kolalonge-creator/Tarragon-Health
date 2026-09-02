-- Module 20 (Health Education Platform) §20.13 — education programmes: an ordered
-- sequence of modules on one condition/topic ("Hypertension Education Programme,
-- Module 1: What is hypertension?..."), rather than a flat article list. A programme
-- module POINTS AT an existing health_education_content row (no content duplication) —
-- the same "reuse, don't rebuild a parallel source of truth" discipline the rest of this
-- feature already follows (see docs/archive/HEALTH_EDUCATION_PATHWAY_SPEC.md §3).
--
-- Global catalogues, same RLS shape as health_education_content: authenticated read of
-- active rows (or admin sees everything), admin-only write. Authoring a programme's
-- module list is migration/seed-authored for now, same deliberate thin slice as
-- health_education_content's own body/knowledge-check authoring — see the admin manager's
-- existing comment to that effect.

create table public.health_education_programmes (
  id           uuid primary key default gen_random_uuid(),
  code         text not null unique,
  title        text not null,
  description  text,
  condition    public.care_plan_condition,
  category     public.health_education_category,
  is_active    boolean not null default true,
  sort_order   integer not null default 100,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create trigger health_education_programmes_set_updated_at
  before update on public.health_education_programmes
  for each row execute function private.set_updated_at();

alter table public.health_education_programmes enable row level security;

create policy health_education_programmes_select on public.health_education_programmes
  for select to authenticated using (is_active or private.is_admin());

create policy health_education_programmes_write on public.health_education_programmes
  for all to authenticated using (private.is_admin()) with check (private.is_admin());

grant select, insert, update, delete on public.health_education_programmes to authenticated;

create table public.health_education_programme_modules (
  id             uuid primary key default gen_random_uuid(),
  programme_id   uuid not null references public.health_education_programmes (id) on delete cascade,
  content_id     uuid not null references public.health_education_content (id) on delete restrict,
  module_number  integer not null check (module_number > 0),
  title          text not null,
  created_at     timestamptz not null default now(),
  unique (programme_id, module_number)
);

create index health_education_programme_modules_content_idx
  on public.health_education_programme_modules (content_id);

alter table public.health_education_programme_modules enable row level security;

create policy health_education_programme_modules_select on public.health_education_programme_modules
  for select to authenticated using (
    private.is_admin()
    or exists (
      select 1 from public.health_education_programmes p
      where p.id = programme_id and p.is_active
    )
  );

create policy health_education_programme_modules_write on public.health_education_programme_modules
  for all to authenticated using (private.is_admin()) with check (private.is_admin());

grant select, insert, update, delete on public.health_education_programme_modules to authenticated;

do $$
begin
  if not has_table_privilege('authenticated', 'public.health_education_programmes', 'SELECT') then
    raise exception 'health_education_programmes: authenticated grant did not take';
  end if;
  if not has_table_privilege('authenticated', 'public.health_education_programme_modules', 'SELECT') then
    raise exception 'health_education_programme_modules: authenticated grant did not take';
  end if;
end $$;

-- ---------------------------------------------------------------------------------
-- Read RPCs — same security-definer, caller-scoped-progress pattern as
-- health_education_feed/library.
-- ---------------------------------------------------------------------------------

create function public.health_education_programmes_list()
returns table (
  id uuid,
  code text,
  title text,
  description text,
  condition public.care_plan_condition,
  category public.health_education_category,
  module_count integer,
  completed_count integer
)
language sql
stable security definer
set search_path = ''
as $$
  select
    p.id,
    p.code,
    p.title,
    p.description,
    p.condition,
    p.category,
    count(m.id)::int as module_count,
    count(*) filter (where prog.status = 'understood')::int as completed_count
  from public.health_education_programmes p
  join public.health_education_programme_modules m on m.programme_id = p.id
  left join public.health_education_progress prog
    on prog.content_id = m.content_id and prog.patient_id = (select auth.uid())
  where p.is_active
  group by p.id
  order by p.sort_order, p.title;
$$;

revoke all on function public.health_education_programmes_list() from public;
revoke all on function public.health_education_programmes_list() from anon;
grant execute on function public.health_education_programmes_list() to authenticated;

create function public.health_education_programme_detail(p_code text)
returns table (
  programme_id uuid,
  programme_code text,
  programme_title text,
  programme_description text,
  module_id uuid,
  module_number integer,
  module_title text,
  content_id uuid,
  content_code text,
  content_title text,
  content_summary text,
  content_body text,
  content_type public.health_education_content_type,
  video_url text,
  audio_url text,
  estimated_minutes integer,
  has_knowledge_check boolean,
  knowledge_check jsonb,
  status public.health_education_status,
  check_score integer,
  check_total integer
)
language sql
stable security definer
set search_path = ''
as $$
  select
    p.id,
    p.code,
    p.title,
    p.description,
    m.id,
    m.module_number,
    m.title,
    c.id,
    c.code,
    c.title,
    c.summary,
    c.body,
    c.content_type,
    c.video_url,
    c.audio_url,
    c.estimated_minutes,
    (c.knowledge_check is not null and jsonb_array_length(c.knowledge_check) > 0),
    c.knowledge_check,
    prog.status,
    prog.check_score,
    prog.check_total
  from public.health_education_programmes p
  join public.health_education_programme_modules m on m.programme_id = p.id
  join public.health_education_content c on c.id = m.content_id
  left join public.health_education_progress prog
    on prog.content_id = c.id and prog.patient_id = (select auth.uid())
  where p.code = p_code and (p.is_active or private.is_admin())
  order by m.module_number;
$$;

revoke all on function public.health_education_programme_detail(text) from public;
revoke all on function public.health_education_programme_detail(text) from anon;
grant execute on function public.health_education_programme_detail(text) to authenticated;
