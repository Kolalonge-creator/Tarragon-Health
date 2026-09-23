-- Tarragon Health — retroactively cancel bogus antenatal_booking schedules
-- created before the antenatal_booking life-stage gate existed.
--
-- computeScreeningRecommendations (apps/web/src/lib/rules/screening-
-- recommendations.ts) applied only screen_types.sex_applicability/age_from/
-- age_to to antenatal_booking ('female', 15-49, no pregnancy signal of its
-- own in the catalogue) — every eligible woman's first risk-assessment
-- submission (onboarding's own general assessment included, which never
-- asks a women's-health question) silently scheduled "Your Antenatal
-- Booking is due" on her dashboard, regardless of whether she was pregnant,
-- trying to conceive, or neither. Fixed going forward by gating on
-- reproductive_health_profiles.life_stage = 'pregnant' (see
-- LIFE_STAGE_GATED_SCREENS in screening-recommendations.ts, same signal
-- cycle-nudges.ts already uses for its own antenatal nudge). This migration
-- closes out the schedules the bug already created before that fix shipped.
--
-- Confirmed via direct query before writing this: exactly 2
-- screening_schedules rows exist for antenatal_booking, both status
-- 'pending', neither patient's reproductive_health_profiles.life_stage is
-- 'pregnant' (one patient has no reproductive_health_profiles row at all,
-- one is 'menstruating') — a small, fully-enumerable blast radius, not a
-- hypothetical one.
--
-- 'cancelled', deliberately not 'declined': private.block_screening_
-- schedule_after_decline (20260829121818_screening_schedule_decline.sql)
-- permanently blocks re-inserting a 'pending' row for a (patient,
-- screen_type_id) pair once a 'declined' row exists for it — using
-- 'declined' here would permanently lock these two patients out of ever
-- being offered antenatal booking again, even once genuinely pregnant.
-- 'cancelled' carries no such block, and actions.ts's activeByScreenTypeId
-- only treats 'pending'/'booked' as active, so a later risk-assessment
-- resubmission with life_stage = 'pregnant' still schedules a fresh row
-- normally.
do $$
declare
  v_fixed integer;
  v_remaining integer;
begin
  -- A correlated subquery, not a LEFT JOIN in the FROM list: an UPDATE's
  -- FROM-list join conditions can't reference the target table (ss) being
  -- updated, only the top-level WHERE can.
  update public.screening_schedules ss
  set status = 'cancelled'
  from public.screen_types st
  where ss.screen_type_id = st.id
    and st.code = 'antenatal_booking'
    and ss.status in ('pending', 'overdue')
    and coalesce(
      (select rhp.life_stage::text from public.reproductive_health_profiles rhp
       where rhp.patient_id = ss.patient_id),
      'not_applicable'
    ) <> 'pregnant';

  get diagnostics v_fixed = row_count;
  raise notice 'cancel_bogus_antenatal_booking_schedules: cancelled % erroneous schedule(s)', v_fixed;

  select count(*) into v_remaining
  from public.screening_schedules ss
  join public.screen_types st on st.id = ss.screen_type_id
  where st.code = 'antenatal_booking'
    and ss.status in ('pending', 'overdue')
    and coalesce(
      (select rhp.life_stage::text from public.reproductive_health_profiles rhp
       where rhp.patient_id = ss.patient_id),
      'not_applicable'
    ) <> 'pregnant';

  if v_remaining <> 0 then
    raise exception 'cancel_bogus_antenatal_booking_schedules: % non-pregnant patient(s) still have an active antenatal_booking schedule', v_remaining;
  end if;
end $$;
