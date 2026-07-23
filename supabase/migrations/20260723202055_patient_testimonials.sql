-- Consented patient testimonials (founder-directed 2026-07-23): the honest
-- social-proof pipeline — a patient volunteers a quote WITH explicit display
-- consent, an admin reviews and publishes, marketing renders only published
-- rows (anon read on published only). Never invented, never scraped, and the
-- display name is chosen by the patient (first name or initials fine).

create table public.patient_testimonials (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete restrict,
  patient_id       uuid not null references public.profiles (id) on delete cascade,
  display_name     text not null,
  quote            text not null check (char_length(quote) between 20 and 500),
  consent_to_publish boolean not null default false,
  status           text not null default 'submitted' check (status in ('submitted', 'published', 'declined')),
  reviewed_by      uuid references public.profiles (id),
  reviewed_at      timestamptz,
  created_at       timestamptz not null default now()
);

alter table public.patient_testimonials enable row level security;

create policy patient_testimonials_select on public.patient_testimonials
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

-- Marketing (anon) may read ONLY published rows.
create policy patient_testimonials_public_read on public.patient_testimonials
  for select to anon
  using (status = 'published');

create policy patient_testimonials_insert on public.patient_testimonials
  for insert to authenticated
  with check (
    patient_id = (select auth.uid())
    and consent_to_publish = true
    and status = 'submitted'
  );

-- Publishing is an admin act; reviewed_by/at are stamped server-side.
create or replace function private.stamp_testimonial_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status and new.status in ('published', 'declined') then
    if not private.is_admin() then
      raise exception 'only an admin can publish or decline a testimonial' using errcode = '42501';
    end if;
    new.reviewed_by := auth.uid();
    new.reviewed_at := now();
  end if;
  return new;
end;
$$;

create trigger patient_testimonials_stamp_review
  before update on public.patient_testimonials
  for each row execute function private.stamp_testimonial_review();

create policy patient_testimonials_update on public.patient_testimonials
  for update to authenticated
  using (private.is_admin())
  with check (private.is_admin());

grant select on public.patient_testimonials to anon;
