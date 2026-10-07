-- A second-pass /code-review high finding on
-- 20260924210347_doctor_testimonials.sql: consent_reference had a floor
-- (char_length(trim(consent_reference)) > 0, "must not be blank") but no
-- ceiling — the app-layer Zod schema had no .max() either, and the form's
-- own maxLength={200} is a plain HTML attribute, trivially bypassed by any
-- direct POST to the server action. Nothing stopped an arbitrarily large
-- string in a column whose whole job is to be a short pointer to where a
-- real consent record lives, not the record itself.
--
-- 500 matches the existing `quote` column's own length ceiling on both
-- testimonial tables — no new convention, reusing the one already in place.

alter table public.doctor_testimonials
  add constraint doctor_testimonials_consent_reference_length
  check (char_length(consent_reference) <= 500);

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'doctor_testimonials_consent_reference_length'
       and contype = 'c'
  ) then
    raise exception 'doctor_testimonials_consent_reference_length constraint is missing';
  end if;
end $$;
