-- Tarragon Health — 12-week two-track chronic-care programme, Phase 2 (review)
--
-- Per CLAUDE.md's "never rebuild the Annual Health Review as a parallel
-- review record" rule, this is a thin orchestration shell, not a new trend-
-- computation engine — created empty (null-gated reviewed_by/reviewed_at,
-- same discipline as ReviewedByDoctor everywhere else) when the week-12
-- programme_end_review occurrence generates. The review UI composes its
-- view live from vitals_readings/patient_risk_scores/appointments/
-- medication_dose_history rather than storing computed trend data
-- redundantly here.

create table public.chronic_programme_end_reviews (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  patient_id      uuid not null references public.profiles (id) on delete cascade,
  enrolment_id    uuid not null unique references public.chronic_programme_enrolments (id) on delete cascade,
  occurrence_id   uuid not null references public.chronic_programme_schedule_occurrences (id) on delete cascade,
  risk_score_id   uuid references public.patient_risk_scores (id) on delete set null,
  reviewed_by     uuid references public.clinical_staff (id) on delete set null,
  reviewed_at     timestamptz,
  summary         text,
  created_at      timestamptz not null default now(),
  constraint chronic_programme_end_reviews_reviewed_together check (
    (reviewed_by is null) = (reviewed_at is null)
  )
);

create index chronic_programme_end_reviews_patient_idx
  on public.chronic_programme_end_reviews (patient_id);

alter table public.chronic_programme_end_reviews enable row level security;

create policy chronic_programme_end_reviews_select on public.chronic_programme_end_reviews
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));
create policy chronic_programme_end_reviews_update on public.chronic_programme_end_reviews
  for update to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

grant select, update on public.chronic_programme_end_reviews to authenticated;

-- Created empty the moment the week-12 programme_end_review occurrence
-- itself is generated — one row per enrolment, never duplicated (the unique
-- constraint on enrolment_id backs the ON CONFLICT).
create or replace function private.create_chronic_programme_end_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.occurrence_type <> 'programme_end_review' then
    return new;
  end if;

  insert into public.chronic_programme_end_reviews
    (organisation_id, patient_id, enrolment_id, occurrence_id)
  values (new.organisation_id, new.patient_id, new.enrolment_id, new.id)
  on conflict (enrolment_id) do nothing;

  return new;
end;
$$;

drop trigger if exists chronic_programme_schedule_occurrences_create_end_review
  on public.chronic_programme_schedule_occurrences;
create trigger chronic_programme_schedule_occurrences_create_end_review
  after insert on public.chronic_programme_schedule_occurrences
  for each row execute function private.create_chronic_programme_end_review();

do $$
begin
  if exists (
    select 1 from pg_policy
    where polrelid = 'public.chronic_programme_end_reviews'::regclass and polcmd = 'a'
  ) then
    raise exception 'FAIL: chronic_programme_end_reviews must not be directly client-insertable';
  end if;
  raise notice 'PASS: chronic programme end-review shell in place';
end $$;
