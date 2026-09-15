-- Tarragon Health — dedicated profiles.height_cm + BMI-height reconciliation
--
-- Height for BMI has lived only in risk_assessment_responses (question_key =
-- 'height_cm', latest-answer-only reads) — profiles had no height column at
-- all. This adds one, makes it the canonical value BMI reads (vitals trend,
-- Health Score, Health Passport — see lib/health-metrics/height.ts), and
-- backfills every existing patient's most recent questionnaire answer into
-- it so nobody regresses to "no height on file" the moment this ships.
--
-- height_reconciled_at exists purely to stop the vitals page's "which
-- height is right?" prompt from re-nagging forever once a patient has
-- picked one: it's stamped whenever profiles.height_cm is explicitly set
-- (settings page, or picking an option on that prompt), and the app only
-- flags a disagreement between profiles.height_cm and the latest
-- risk_assessment_responses answer when that answer is NEWER than the last
-- reconciliation — see fetchHeightStatus. Not policed at the DB level
-- (nothing here depends on it for correctness beyond that UX), so it's a
-- plain timestamp column, not a trigger-enforced invariant.
--
-- Range mirrors the existing patient self-report bounds in
-- lib/validation/risk-assessment.ts (100-230cm) rather than the wider
-- clinician-measured obesity_assessments range (50-300cm) — this column is
-- patient-self-reported, same provenance as the questionnaire answer it's
-- reconciled against, not the clinician-measured obesity pathway.
--
-- No RLS/grant changes needed: profiles already grants patient
-- self-update (profiles_update policy, core_auth_multitenancy.sql), and
-- private.guard_profiles_self_update()'s denylist
-- (fix_profiles_self_update_column_guard_account_purpose_bug.sql) doesn't
-- name height_cm, so it's freely patient-self-editable like
-- date_of_birth/sex already are.

alter table public.profiles
  add column height_cm numeric(5,1),
  add column height_reconciled_at timestamptz;

alter table public.profiles
  add constraint profiles_height_cm_range check (height_cm > 100 and height_cm < 230);

comment on column public.profiles.height_cm is
  'Canonical patient height for BMI (vitals trend, Health Score, Health Passport). Reconciled against the latest risk_assessment_responses height_cm answer in app code — see lib/health-metrics/height.ts — never overwritten silently once set.';
comment on column public.profiles.height_reconciled_at is
  'When the patient last explicitly confirmed height_cm (settings edit, or resolving a disagreement with their risk-assessment answer). A later questionnaire retake with a different height re-flags only if it postdates this.';

-- Backfill: every patient's most recent questionnaire height becomes their
-- profile height. Nothing to reconcile yet at migration time — a single
-- source, promoted into the new dedicated column — so height_reconciled_at
-- is stamped too (a later differing retake will correctly flag against it).
with latest_height_answers as (
  select distinct on (profile_id)
    profile_id,
    (response #>> '{}')::numeric as height_cm,
    created_at
  from public.risk_assessment_responses
  where question_key = 'height_cm'
  order by profile_id, created_at desc
)
update public.profiles p
set height_cm = a.height_cm,
    height_reconciled_at = a.created_at
from latest_height_answers a
where p.id = a.profile_id
  and p.height_cm is null
  and a.height_cm > 100 and a.height_cm < 230;

do $$
declare
  backfilled_count int;
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'height_cm'
  ) then
    raise exception 'FAIL: profiles.height_cm was not created';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'height_reconciled_at'
  ) then
    raise exception 'FAIL: profiles.height_reconciled_at was not created';
  end if;
  select count(*) into backfilled_count from public.profiles where height_cm is not null;
  raise notice 'PASS: profiles height columns created, % profile(s) backfilled from risk_assessment_responses', backfilled_count;
end $$;
