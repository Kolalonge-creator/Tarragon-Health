-- Tarragon Health — Men's Health Platform (CLAUDE.md §45): structured
-- self-assessments for erectile dysfunction, prostate urinary symptoms, and
-- male fertility.
--
-- Brand-new tables (no existing rows to migrate/count). Modelled directly on
-- mental_health_screens (20260719144000_mental_health_screens.sql): a
-- patient-authored, standard/structured instrument, scored deterministically
-- server-side (apps/web/src/lib/rules/{ed-assessment-scoring,
-- prostate-symptom-scoring,male-fertility-assessment}.ts) and written via the
-- service role — a client can never post a spoofed total or suggestion flag.
-- Read-only history: patient reads own, org staff read within the org
-- (heightened-confidentiality data, same RLS shape as the rest of the
-- record). No insert/update/delete grant to `authenticated` at all.
--
-- §45.5's workflow ("structured assessment -> risk screening -> clinical
-- consultation") and §45.7's ("symptom assessment -> risk assessment ->
-- appropriate clinical consultation") are both satisfied the same way
-- private.handle_abnormal_screening_result() and handle_symptom_red_flag()
-- already satisfy theirs: an AFTER INSERT trigger raises a routine
-- clinician_alerts row (level='clinician_review') whenever the assessment is
-- clinically indicated, so the existing clinician escalations queue — not a
-- bespoke new review screen — is the "clinical consultation" step. This is
-- deliberately NOT an urgent_escalation/SLA-timed alert (nothing here is
-- time-critical the way a red-flag vital/symptom is), so no sla_due_at is
-- set and no new escalation_slas pathway is registered.
--
-- Testicular symptoms are NOT a new table here — an urgent testicular
-- symptom reuses the existing patient-authored `symptoms` table exactly the
-- way chest_pain/severe_headache do (see the companion migration
-- 20260829101512_testicular_symptom_red_flag.sql).
--
-- PSA testing is never auto-suggested by a symptom score here — see
-- prostate-symptom-scoring.ts's own header on why `psa_conversation_suggested`
-- is age/family-history-only, mirroring the platform's existing PSA
-- shared-decision-making gate (screening_cadence_and_psa_sdm_gate.sql).

-- ---------------------------------------------------------------------------
-- 1. erectile_dysfunction_assessments (IIEF-5)
-- ---------------------------------------------------------------------------
create table public.erectile_dysfunction_assessments (
  id                                uuid primary key default gen_random_uuid(),
  organisation_id                   uuid not null references public.organisations (id) on delete restrict,
  patient_id                        uuid not null references public.profiles (id) on delete cascade,
  total_score                       integer not null check (total_score between 5 and 25),
  severity_band                     text not null
                                       check (severity_band in ('severe', 'moderate', 'mild_moderate', 'mild', 'none')),
  cardiometabolic_review_suggested  boolean not null default false,
  item_responses                    jsonb not null default '{}'::jsonb,
  created_at                        timestamptz not null default now()
);

create index erectile_dysfunction_assessments_patient_idx on public.erectile_dysfunction_assessments (patient_id, created_at desc);

alter table public.erectile_dysfunction_assessments enable row level security;

create policy erectile_dysfunction_assessments_select on public.erectile_dysfunction_assessments
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

grant select on public.erectile_dysfunction_assessments to authenticated;

-- ---------------------------------------------------------------------------
-- 2. prostate_symptom_assessments (IPSS)
-- ---------------------------------------------------------------------------
create table public.prostate_symptom_assessments (
  id                          uuid primary key default gen_random_uuid(),
  organisation_id             uuid not null references public.organisations (id) on delete restrict,
  patient_id                  uuid not null references public.profiles (id) on delete cascade,
  total_score                 integer not null check (total_score between 0 and 35),
  severity_band               text not null check (severity_band in ('mild', 'moderate', 'severe')),
  psa_conversation_suggested  boolean not null default false,
  item_responses               jsonb not null default '{}'::jsonb,
  created_at                  timestamptz not null default now()
);

create index prostate_symptom_assessments_patient_idx
  on public.prostate_symptom_assessments (patient_id, created_at desc);

alter table public.prostate_symptom_assessments enable row level security;

create policy prostate_symptom_assessments_select on public.prostate_symptom_assessments
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

grant select on public.prostate_symptom_assessments to authenticated;

-- ---------------------------------------------------------------------------
-- 3. male_fertility_assessments
-- ---------------------------------------------------------------------------
create table public.male_fertility_assessments (
  id                          uuid primary key default gen_random_uuid(),
  organisation_id             uuid not null references public.organisations (id) on delete restrict,
  patient_id                  uuid not null references public.profiles (id) on delete cascade,
  trying_to_conceive_months   integer not null check (trying_to_conceive_months >= 0),
  risk_factors                jsonb not null default '[]'::jsonb,
  prior_semen_analysis        text not null default 'none'
                                 check (prior_semen_analysis in ('none', 'normal', 'abnormal', 'pending')),
  semen_analysis_suggested    boolean not null default false,
  created_at                  timestamptz not null default now()
);

create index male_fertility_assessments_patient_idx
  on public.male_fertility_assessments (patient_id, created_at desc);

alter table public.male_fertility_assessments enable row level security;

create policy male_fertility_assessments_select on public.male_fertility_assessments
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

grant select on public.male_fertility_assessments to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Routine clinical-consultation triggers -> clinician_alerts
-- ---------------------------------------------------------------------------
create or replace function private.handle_erectile_dysfunction_assessment_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.severity_band = 'none' then
    return new;
  end if;

  insert into public.clinician_alerts
    (organisation_id, patient_id, level, status, title, detail)
  values (
    new.organisation_id,
    new.patient_id,
    'clinician_review',
    'open',
    'Erectile dysfunction assessment: clinical consultation suggested',
    format(
      'Patient completed an erectile dysfunction self-assessment (IIEF-5 score %s/25, %s).%s',
      new.total_score,
      new.severity_band,
      case
        when new.cardiometabolic_review_suggested
          then ' Erectile dysfunction can coexist with cardiovascular/metabolic risk — consider a BP, lipid and blood-sugar review alongside the consultation.'
        else ''
      end
    )
  );

  return new;
end;
$$;

create trigger erectile_dysfunction_assessments_review_check
  after insert on public.erectile_dysfunction_assessments
  for each row execute function private.handle_erectile_dysfunction_assessment_review();

create or replace function private.handle_prostate_symptom_assessment_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.severity_band = 'mild' and not new.psa_conversation_suggested then
    return new;
  end if;

  insert into public.clinician_alerts
    (organisation_id, patient_id, level, status, title, detail)
  values (
    new.organisation_id,
    new.patient_id,
    'clinician_review',
    'open',
    'Prostate symptom assessment: clinical consultation suggested',
    format(
      'Patient completed a prostate urinary symptom self-assessment (IPSS score %s/35, %s).%s',
      new.total_score,
      new.severity_band,
      case
        when new.psa_conversation_suggested
          then ' Patient is in an age/family-history band where a PSA-testing conversation is reasonable — this is a discussion to have, not an automatic order (see the shared-decision-making gate on the psa screen type).'
        else ''
      end
    )
  );

  return new;
end;
$$;

create trigger prostate_symptom_assessments_review_check
  after insert on public.prostate_symptom_assessments
  for each row execute function private.handle_prostate_symptom_assessment_review();

create or replace function private.handle_male_fertility_assessment_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not new.semen_analysis_suggested then
    return new;
  end if;

  insert into public.clinician_alerts
    (organisation_id, patient_id, level, status, title, detail)
  values (
    new.organisation_id,
    new.patient_id,
    'clinician_review',
    'open',
    'Male fertility assessment: investigation/referral may be appropriate',
    format(
      'Patient reported trying to conceive for %s months (risk factors: %s). A semen analysis, and specialist referral if indicated, is a reasonable next step.',
      new.trying_to_conceive_months,
      case when jsonb_array_length(new.risk_factors) = 0 then 'none reported'
           else (select string_agg(value #>> '{}', ', ') from jsonb_array_elements(new.risk_factors))
      end
    )
  );

  return new;
end;
$$;

create trigger male_fertility_assessments_review_check
  after insert on public.male_fertility_assessments
  for each row execute function private.handle_male_fertility_assessment_review();

-- ---------------------------------------------------------------------------
-- 5. Assertions
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.erectile_dysfunction_assessments') is null then
    raise exception 'erectile_dysfunction_assessments was not created';
  end if;
  if to_regclass('public.prostate_symptom_assessments') is null then
    raise exception 'prostate_symptom_assessments was not created';
  end if;
  if to_regclass('public.male_fertility_assessments') is null then
    raise exception 'male_fertility_assessments was not created';
  end if;

  if not exists (
    select 1 from pg_proc
    where proname = 'handle_erectile_dysfunction_assessment_review' and pronamespace = 'private'::regnamespace
  ) then
    raise exception 'private.handle_erectile_dysfunction_assessment_review was not created';
  end if;
  if not exists (
    select 1 from pg_proc
    where proname = 'handle_prostate_symptom_assessment_review' and pronamespace = 'private'::regnamespace
  ) then
    raise exception 'private.handle_prostate_symptom_assessment_review was not created';
  end if;
  if not exists (
    select 1 from pg_proc
    where proname = 'handle_male_fertility_assessment_review' and pronamespace = 'private'::regnamespace
  ) then
    raise exception 'private.handle_male_fertility_assessment_review was not created';
  end if;

  if not (select relrowsecurity from pg_class where oid = 'public.erectile_dysfunction_assessments'::regclass) then
    raise exception 'erectile_dysfunction_assessments RLS is not enabled';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.prostate_symptom_assessments'::regclass) then
    raise exception 'prostate_symptom_assessments RLS is not enabled';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.male_fertility_assessments'::regclass) then
    raise exception 'male_fertility_assessments RLS is not enabled';
  end if;
end $$;
