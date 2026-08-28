-- Tarragon Health — medication review structured domains (13.11/13.18)
--
-- medication_reviews (20260716172000) already schedules/rolls/attributes
-- reviews correctly; its only content field is one free-text `notes` column.
-- 13.11 names seven domains a review should assess (effectiveness, adherence,
-- side effects, affordability, monitoring, ongoing indication, patient
-- preference) and 13.18's acceptance criteria specifically calls out "is it
-- working?" and "is it still appropriate?" as the two hardest questions to
-- answer from a free-text note. This adds one discrete column/flag per
-- domain — `notes` stays exactly as-is for anything that doesn't fit a flag,
-- so no existing reader or writer of this table is disturbed.
--
-- All additive/nullable-or-defaulted; a review completed before this
-- migration simply carries the defaults (not_assessed / false / null), which
-- read honestly as "not assessed", not as a false negative.

do $$ begin
  if not exists (select 1 from pg_type where typname = 'medication_review_effectiveness') then
    create type public.medication_review_effectiveness as enum (
      'effective', 'partially_effective', 'not_effective', 'too_early_to_tell'
    );
  end if;
end $$;

alter table public.medication_reviews
  add column if not exists effectiveness_assessment        public.medication_review_effectiveness,
  add column if not exists adherence_reviewed               boolean not null default false,
  add column if not exists side_effects_reviewed            boolean not null default false,
  add column if not exists affordability_reviewed           boolean not null default false,
  add column if not exists affordability_barrier_identified boolean,
  add column if not exists monitoring_reviewed              boolean not null default false,
  add column if not exists ongoing_indication_confirmed     boolean,
  add column if not exists patient_preference_notes         text;

alter table public.medication_reviews
  add constraint medication_reviews_patient_preference_notes_length
    check (char_length(patient_preference_notes) <= 1000);

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'medication_reviews'
      and column_name = 'effectiveness_assessment'
  ) then
    raise exception 'medication_reviews.effectiveness_assessment was not added';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'medication_reviews'
      and column_name = 'ongoing_indication_confirmed'
  ) then
    raise exception 'medication_reviews.ongoing_indication_confirmed was not added';
  end if;
  raise notice 'PASS: medication_reviews gained structured domain columns';
end $$;
