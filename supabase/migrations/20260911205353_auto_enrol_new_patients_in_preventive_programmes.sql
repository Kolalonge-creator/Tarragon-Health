-- Tarragon Health — auto-enrol new patients into preventive programmes.
--
-- Founder decision 2026-09-11: preventive_programme_enrolments has been
-- opt-in only since it shipped (20260716191000_preventive_programmes.sql) —
-- a patient only gets a track if they find the Prevention > Programmes tab
-- and press "Enrol". Founder feedback: a patient who never finds that
-- button never gets the platform's most important feature. Flipped to
-- opt-out: every new patient is auto-enrolled, the instant onboarding
-- completes, into whichever programmes their profile already qualifies for
-- (source = 'recommended', mirroring computePreventiveProgrammeRecommendations
-- in apps/web/src/lib/rules/preventive-programme-recommendations.ts) — they
-- can still withdraw from any of them at any time via the existing
-- Withdraw control (preventive-programmes.tsx).
--
-- Scope, per explicit founder decision:
--   - Age/sex-appropriate programmes only, not a blanket "all 5 for
--     everyone" — a male patient is never auto-enrolled in Women's Health
--     Screening. Annual Health Check is universal (same rule the TS
--     recommendation engine already applies).
--   - cardiometabolic_prevention is NOT decided here — it depends on risk
--     tiers that don't exist until the risk-assessment questionnaire runs,
--     so it's auto-enrolled from submitRiskAssessment
--     (apps/web/src/app/(dashboard)/patient/actions.ts) instead, right after
--     the tiers are computed there.
--   - Only accounts that actually receive care (receives_care = true) are
--     enrolled — a supporter/dependent-manager account can complete
--     onboarding with no date_of_birth/sex on file at all (see
--     private.enforce_onboarding_prereqs), so this guard is load-bearing,
--     not defensive: without it every such account would still get
--     annual_health_check (the one unconditional code) despite never
--     receiving care here.
--   - NEW SIGNUPS ONLY. Existing patients are deliberately NOT backfilled
--     in this migration — auto-enrolling the whole existing patient base at
--     once would also mass-schedule a preventive_reviews row per enrolment
--     via the existing private.ensure_preventive_review() trigger, a real
--     one-time spike in clinician review volume for a small clinical team.
--     Revisit backfilling existing patients as a separate, deliberate pass.
--
-- Idempotency note: preventive_enrolments_one_active is a PARTIAL unique
-- index (where status = 'enrolled'), so it does not stop a naive
-- "not already enrolled" check from re-inserting a row for a programme the
-- patient explicitly withdrew from. This trigger instead checks for ANY
-- prior enrolment row (any status) for that patient+programme pair before
-- inserting, so a withdrawal is never silently undone by this trigger
-- re-firing (e.g. on a future unrelated profile update).

create or replace function private.auto_enrol_preventive_programmes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_age integer;
  v_codes text[];
begin
  if new.role = 'patient'
     and new.receives_care
     and new.onboarding_completed_at is not null
     and (tg_op = 'INSERT' or old.onboarding_completed_at is null)
     and new.organisation_id is not null
  then
    v_age := date_part('year', age(current_date, new.date_of_birth))::integer;
    v_codes := array['annual_health_check'];

    if new.sex = 'female' and v_age >= 21 then
      v_codes := array_append(v_codes, 'womens_health');
    end if;
    if new.sex = 'male' and v_age >= 40 then
      v_codes := array_append(v_codes, 'mens_health');
    end if;
    if v_age >= 45 then
      v_codes := array_append(v_codes, 'cancer_screening');
    end if;

    insert into public.preventive_programme_enrolments
      (organisation_id, patient_id, programme_id, status, source, enrolled_at)
    select new.organisation_id, new.id, pp.id, 'enrolled', 'recommended', now()
    from public.preventive_programmes pp
    where pp.code = any(v_codes)
      and pp.is_active
      and not exists (
        select 1 from public.preventive_programme_enrolments e
        where e.patient_id = new.id and e.programme_id = pp.id
      );
  end if;
  return new;
end;
$$;

drop trigger if exists auto_enrol_preventive_programmes on public.profiles;
create trigger auto_enrol_preventive_programmes
  after insert or update of onboarding_completed_at on public.profiles
  for each row execute function private.auto_enrol_preventive_programmes();
