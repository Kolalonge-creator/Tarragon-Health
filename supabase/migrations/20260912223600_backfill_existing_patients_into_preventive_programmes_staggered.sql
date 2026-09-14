-- Tarragon Health — backfill existing patients into preventive programmes,
-- with staggered review due-dates.
--
-- Founder decision 2026-09-12: the previous auto-enrol migration
-- (20260911205353_auto_enrol_new_patients_in_preventive_programmes.sql)
-- deliberately covered NEW SIGNUPS ONLY, flagging that backfilling the
-- existing patient base would mass-schedule a preventive_reviews row per
-- enrolment (via the existing private.ensure_preventive_review() trigger)
-- all landing on the SAME due date per programme — a real one-time spike
-- in clinician review volume. Founder asked for the backfill too, staggered.
--
-- Eligibility mirrors private.auto_enrol_preventive_programmes() exactly:
-- role='patient', receives_care, onboarding_completed_at set, an
-- organisation on file. Programme codes: annual_health_check (universal),
-- womens_health (female, 21+), mens_health (male, 40+), cancer_screening
-- (45+) — plus cardiometabolic_prevention here, using each patient's
-- latest prevention_risk_scores tier per condition (hypertension/diabetes/
-- cvd), same very_high->high / unknown->low collapse and moderate+
-- threshold as computePreventiveProgrammeRecommendations
-- (apps/web/src/lib/rules/preventive-programme-recommendations.ts).
-- (New signups get cardiometabolic_prevention from submitRiskAssessment
-- instead, since a brand-new patient has no risk scores yet; an existing
-- patient already might, so it's included in this one-off sweep.)
--
-- Idempotency: skips any (patient, programme) pair with ANY existing
-- enrolment row, any status — never re-enrols a programme a patient has
-- ever withdrawn from (preventive_enrolments_one_active is a PARTIAL
-- unique index and would not itself catch this).
--
-- Staggering: the ensure_preventive_review trigger fires normally on each
-- inserted 'enrolled' row (due_date = current_date + cadence_months, the
-- same day for every row in one bulk insert). Immediately after, this
-- migration re-spreads each programme's freshly-created pending reviews
-- evenly across that programme's own cadence window (0..cadence_months),
-- ordered by enrolment_id for a deterministic, auditable spread — a
-- single-patient cohort still lands on day 0 (no artificial deferral for
-- the common single-patient case). This reproduces the steady-state
-- review rate the programme is designed for (~N/cadence_months reviews
-- due per month) instead of a one-time cliff.
--
-- Applied live 2026-09-12: 16 new enrolments across 8 existing patients
-- (annual_health_check 8, womens_health 5, cancer_screening 2,
-- mens_health 1, cardiometabolic_prevention 0), due dates confirmed
-- spread across each programme's cadence window rather than clustered.

create temporary table tmp_backfill_enrolments (
  enrolment_id uuid not null,
  programme_id uuid not null
);

with base as (
  select
    p.id as patient_id,
    p.organisation_id,
    p.sex,
    date_part('year', age(current_date, p.date_of_birth))::integer as age_years
  from public.profiles p
  where p.role = 'patient'
    and p.receives_care
    and p.onboarding_completed_at is not null
    and p.organisation_id is not null
),
demo_codes as (
  select b.patient_id, b.organisation_id, unnest(
    array['annual_health_check']
    || case when b.sex = 'female' and b.age_years >= 21 then array['womens_health'] else array[]::text[] end
    || case when b.sex = 'male' and b.age_years >= 40 then array['mens_health'] else array[]::text[] end
    || case when b.age_years >= 45 then array['cancer_screening'] else array[]::text[] end
  ) as code
  from base b
),
latest_scores as (
  select distinct on (profile_id, condition) profile_id, condition, tier
  from public.prevention_risk_scores
  where condition in ('hypertension', 'diabetes', 'cvd')
  order by profile_id, condition, computed_at desc
),
cardio_eligible as (
  select distinct profile_id as patient_id
  from latest_scores
  where (case when tier = 'very_high' then 'high' when tier = 'unknown' then 'low' else tier::text end)
        in ('moderate', 'high')
),
cardio_codes as (
  select b.patient_id, b.organisation_id, 'cardiometabolic_prevention'::text as code
  from base b
  join cardio_eligible ce on ce.patient_id = b.patient_id
),
all_codes as (
  select * from demo_codes
  union
  select * from cardio_codes
),
to_insert as (
  select distinct ac.patient_id, ac.organisation_id, pp.id as programme_id
  from all_codes ac
  join public.preventive_programmes pp on pp.code = ac.code and pp.is_active
  where not exists (
    select 1 from public.preventive_programme_enrolments e
    where e.patient_id = ac.patient_id and e.programme_id = pp.id
  )
),
inserted as (
  insert into public.preventive_programme_enrolments
    (organisation_id, patient_id, programme_id, status, source, enrolled_at)
  select organisation_id, patient_id, programme_id, 'enrolled', 'recommended', now()
  from to_insert
  returning id as enrolment_id, programme_id
)
insert into tmp_backfill_enrolments (enrolment_id, programme_id)
select enrolment_id, programme_id from inserted;

with ranked as (
  select
    pr.id as review_id,
    (row_number() over (partition by tbe.programme_id order by pr.enrolment_id) - 1) as idx,
    count(*) over (partition by tbe.programme_id) as cohort_size,
    pp.review_cadence_months
  from public.preventive_reviews pr
  join tmp_backfill_enrolments tbe on tbe.enrolment_id = pr.enrolment_id
  join public.preventive_programmes pp on pp.id = tbe.programme_id
  where pr.status = 'pending'
)
update public.preventive_reviews pr
set due_date = current_date + ((floor(ranked.idx * (ranked.review_cadence_months * 30.0)
                 / greatest(ranked.cohort_size, 1)))::int || ' days')::interval
from ranked
where pr.id = ranked.review_id;

drop table tmp_backfill_enrolments;
