-- Marketing site lead capture (docs/MARKETING_SITE_SPEC.md §3.7)
-- Inserts happen via server action + service role only — no public insert policy.

create type public.lead_role as enum (
  'patient',
  'family',
  'employer',
  'hmo',
  'other'
);

create table public.leads (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  contact     text not null,
  role        public.lead_role not null,
  message     text,
  source      text not null default 'homepage',
  created_at  timestamptz not null default now(),
  constraint leads_name_not_blank check (char_length(trim(name)) > 0),
  constraint leads_contact_not_blank check (char_length(trim(contact)) > 0)
);

create index leads_created_at_idx on public.leads (created_at desc);
create index leads_source_idx on public.leads (source);

alter table public.leads enable row level security;

-- Admins may read leads for follow-up; writes are service-role only.
create policy leads_admin_select on public.leads
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.profiles
      where profiles.id = auth.uid()
        and profiles.role = 'admin'
    )
  );
