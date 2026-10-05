-- Doctor-side counterpart to patient_testimonials
-- (20260723202055_patient_testimonials.sql), built on an explicit founder
-- decision (2026-09-24) that a doctor testimonial cannot follow the patient
-- self-submit flow: the patient version's consent is a same-session, in-app
-- checkbox from the person the quote is about; a doctor's quote is an
-- employee's name going on public marketing, which the founder decided
-- needs a real consent artifact captured OFF-platform (a signed release, an
-- email, a documented verbal OK) rather than a checkbox. Same founder pass
-- also decided attribution stays first-name + generic role only ("Dr.
-- Adaeze, TarragonHealth care team") — never a surname, tier, specialty, or
-- credential number — matching the existing "a real care team, not one
-- named doctor" brand rule (CLAUDE.md's "never promise ONE continuous named
-- doctor" bullet). That's why this table stores its own plain `display_name`
-- rather than reading `clinical_staff.full_name`/`specialty` at render time.
--
-- Same "dormant until real" discipline as patient_testimonials: an admin
-- creates the row (never the doctor, never a self-serve form), a *separate*
-- admin publish action moves it live, and marketing renders nothing until a
-- row is actually published. consent_reference is NOT NULL and free text on
-- purpose — it's not a lawfulness gate the database can verify (unlike
-- patient_testimonials.consent_to_publish, a real boolean the patient set),
-- it is a require-a-human-to-write-down-where-the-consent-lives field, so an
-- admin can never publish a quote without at least naming the off-platform
-- consent record they're relying on.

create table public.doctor_testimonials (
  id                 uuid primary key default gen_random_uuid(),
  organisation_id    uuid not null references public.organisations (id) on delete restrict,
  clinical_staff_id  uuid not null references public.clinical_staff (id) on delete restrict,
  display_name       text not null check (char_length(display_name) between 1 and 40),
  quote              text not null check (char_length(quote) between 20 and 500),
  condition          text,
  consent_reference  text not null check (char_length(trim(consent_reference)) > 0),
  status             text not null default 'submitted' check (status in ('submitted', 'published', 'declined')),
  created_by         uuid not null references public.profiles (id),
  reviewed_by        uuid references public.profiles (id),
  reviewed_at        timestamptz,
  created_at         timestamptz not null default now()
);

comment on column public.doctor_testimonials.display_name is
  'First-name + generic role style only (e.g. "Dr. Adaeze") — never a surname, tier, specialty, or credential. See migration header.';
comment on column public.doctor_testimonials.consent_reference is
  'Where the off-platform consent for publishing this quote/name is recorded (e.g. "Signed release, HR drive, 2026-09-24"). Required before a row can even be created as a draft — not itself proof of consent, but forces the admin to point at a real record.';
comment on column public.doctor_testimonials.condition is
  'Optional condition-page slug this quote is about, same convention as patient_testimonials.condition.';

create index doctor_testimonials_org_idx on public.doctor_testimonials (organisation_id);
create index doctor_testimonials_clinical_staff_idx on public.doctor_testimonials (clinical_staff_id);

alter table public.doctor_testimonials enable row level security;

-- No "own record" read path (doctors never submit or view this table
-- directly) — org staff can see the moderation queue, same breadth
-- patient_testimonials grants its own staff.
create policy doctor_testimonials_select on public.doctor_testimonials
  for select to authenticated
  using (private.is_org_staff(organisation_id));

-- Marketing (anon) may read ONLY published rows.
create policy doctor_testimonials_public_read on public.doctor_testimonials
  for select to anon
  using (status = 'published');

-- Admin-entered only: this is the structural enforcement of the founder's
-- "admin-entered, off-platform consent" decision — there is no insert path
-- open to a plain clinician account at all.
create policy doctor_testimonials_insert on public.doctor_testimonials
  for insert to authenticated
  with check (
    private.is_admin()
    and created_by = (select auth.uid())
    and status = 'submitted'
  );

-- Publishing is a second, separate admin act from creation (even though the
-- same admin may do both) — reviewed_by/at are stamped server-side, mirroring
-- patient_testimonials_stamp_review.
create or replace function private.stamp_doctor_testimonial_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status and new.status in ('published', 'declined') then
    if not private.is_admin() then
      raise exception 'only an admin can publish or decline a doctor testimonial' using errcode = '42501';
    end if;
    new.reviewed_by := auth.uid();
    new.reviewed_at := now();
  end if;
  return new;
end;
$$;

create trigger doctor_testimonials_stamp_review
  before update on public.doctor_testimonials
  for each row execute function private.stamp_doctor_testimonial_review();

create policy doctor_testimonials_update on public.doctor_testimonials
  for update to authenticated
  using (private.is_admin())
  with check (private.is_admin());

grant select on public.doctor_testimonials to anon;
