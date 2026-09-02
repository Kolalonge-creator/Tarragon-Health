create table if not exists public.health_education_translations (
  id              uuid primary key default gen_random_uuid(),
  content_id      uuid not null references public.health_education_content (id) on delete cascade,
  language        text not null check (language in ('pcm', 'yo', 'ha', 'ig')),
  title           text not null,
  summary         text,
  body            text not null,
  translated_by   text,
  translated_at   timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (content_id, language)
);

create index if not exists health_education_translations_content_idx
  on public.health_education_translations (content_id, language);

alter table public.health_education_translations enable row level security;

drop policy if exists health_education_translations_select on public.health_education_translations;
create policy health_education_translations_select on public.health_education_translations
  for select to authenticated
  using (true);

drop policy if exists health_education_translations_write on public.health_education_translations;
create policy health_education_translations_write on public.health_education_translations
  for all to authenticated
  using (private.is_admin())
  with check (private.is_admin());

grant select, insert, update, delete on public.health_education_translations to authenticated;

drop trigger if exists health_education_translations_set_updated_at on public.health_education_translations;
create trigger health_education_translations_set_updated_at
  before update on public.health_education_translations
  for each row execute function private.set_updated_at();
