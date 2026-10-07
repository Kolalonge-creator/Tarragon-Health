-- Follow-up to 20260924205640_patient_testimonials_condition_tag.sql and
-- 20260924210347_doctor_testimonials.sql, from a /code-review high pass on
-- both. Two real gaps, both found independently by more than one review
-- angle:
--
-- 1. `condition` on either table was free text validated only in the Zod
--    schemas (apps/web/src/app/(dashboard)/patient/testimonials/actions.ts,
--    apps/web/src/app/(dashboard)/admin/doctor-testimonials/actions.ts) —
--    nothing at the DB level stopped a value that matches no real
--    TestimonialsSection/DoctorTestimonialsSection `condition` prop from
--    being inserted directly (a seed script, a future admin tool, a manual
--    fix). A testimonial like that would pass every RLS/consent check, get
--    published by an admin who believes it's now live, and then render
--    nowhere — the exact "silent disable looks like an empty result"
--    failure class this project has been burned by before. A CHECK against
--    the two condition-page slugs that actually have a TestimonialsSection
--    mounted (apps/web/src/lib/testimonials/conditions.ts is the shared
--    source of truth for the app-layer side of this list) turns that into a
--    loud insert-time failure instead.
--
-- 2. `doctor_testimonials_insert`'s RLS only checks `private.is_admin()` —
--    which is TRUE for every admin account platform-wide, not scoped to the
--    row's own `organisation_id` (see `private.is_org_staff`'s `role =
--    'admin'` bypass in 20260705211044_core_auth_multitenancy.sql). Nothing
--    stopped a `doctor_testimonials` row from referencing a
--    `clinical_staff_id` belonging to a DIFFERENT organisation than the
--    row's own `organisation_id`. The app layer now scopes the clinician
--    picker to the admin's own org
--    (apps/web/src/app/(dashboard)/admin/doctor-testimonials/page.tsx) and
--    double-checks before insert
--    (apps/web/src/app/(dashboard)/admin/doctor-testimonials/actions.ts),
--    but per this platform's own standing rule ("RLS enforced at the
--    Postgres level... never filter in application code instead"), the real
--    enforcement belongs here, not just in the app.
--
-- Also folds in one more hardening found in the same pass: the review
-- trigger only ever SET reviewed_by/reviewed_at forward (on a transition
-- INTO published/declined); if a row were ever moved back to 'submitted'
-- (no UI does this today, but nothing stops a future one), the old
-- reviewer/timestamp would stay attached to a row that is, once again,
-- awaiting review — misleadingly implying it was already reviewed. Cheap to
-- close at the root now rather than rediscover later.

alter table public.patient_testimonials
  add constraint patient_testimonials_condition_known
  check (condition is null or condition in ('hypertension', 'diabetes'));

alter table public.doctor_testimonials
  add constraint doctor_testimonials_condition_known
  check (condition is null or condition in ('hypertension', 'diabetes'));

create or replace function private.enforce_doctor_testimonial_org_match()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff_org uuid;
begin
  select organisation_id into v_staff_org
    from public.clinical_staff where id = new.clinical_staff_id;

  if v_staff_org is null then
    raise exception 'clinical_staff_id % does not exist', new.clinical_staff_id using errcode = '23503';
  end if;

  if v_staff_org is distinct from new.organisation_id then
    raise exception
      'doctor_testimonials.organisation_id (%) must match the referenced clinician''s own organisation_id (%)',
      new.organisation_id, v_staff_org
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger doctor_testimonials_enforce_org_match
  before insert or update of clinical_staff_id, organisation_id on public.doctor_testimonials
  for each row execute function private.enforce_doctor_testimonial_org_match();

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
  elsif new.status is distinct from old.status and new.status = 'submitted' then
    -- A row moved back to "awaiting review" is not, in fact, reviewed —
    -- never let it keep carrying a stale reviewer/timestamp from a prior
    -- publish/decline.
    new.reviewed_by := null;
    new.reviewed_at := null;
  end if;
  return new;
end;
$$;

-- Structural proof, matching this project's convention of ending a
-- migration with a DO block of assertions rather than hoping the DDL above
-- did what it says. The actual behavioural proof (a real insert rejected,
-- a real cross-org row rejected) lives in
-- packages/db/tests/doctor_testimonials.sql, run against a full session.
do $$
declare
  v_condition_checks int;
  v_trigger_exists boolean;
begin
  select count(*) into v_condition_checks
    from pg_constraint
   where conname in ('patient_testimonials_condition_known', 'doctor_testimonials_condition_known')
     and contype = 'c';
  if v_condition_checks <> 2 then
    raise exception 'expected both condition CHECK constraints to exist, found %', v_condition_checks;
  end if;

  select exists (
    select 1 from pg_trigger
     where tgname = 'doctor_testimonials_enforce_org_match'
       and tgrelid = 'public.doctor_testimonials'::regclass
  ) into v_trigger_exists;
  if not v_trigger_exists then
    raise exception 'doctor_testimonials_enforce_org_match trigger is missing';
  end if;
end $$;
