-- Tarragon Health — correction to 20260922190610, found in that same PR's
-- own mandated /code-review high pass.
--
-- (1) urine_acr's is_active = false was the WRONG mechanism. Two live
-- triggers gate their entire lookup on `screen_types.is_active = true` and
-- silently no-op otherwise: private.refresh_screening_schedule_on_result
-- (rolls a screening_results row to the next cycle — the mechanism a
-- diabetic/hypertensive/CKD patient's ongoing urine ACR monitoring actually
-- depends on) and private.apply_screening_result_recall (a CLINICIAN'S
-- explicit "recheck in N months" follow-up action on an abnormal result).
-- Deactivating is_active silently broke BOTH for every patient, contradicting
-- 20260922190610's own stated intent ("still ordered directly for
-- diabetes/hypertension/CKD monitoring") — a real regression for exactly the
-- population urine_acr matters most for, found before merge, not after.
--
-- Investigated whether to instead add an is_optional-aware guard to those
-- two trigger functions (matching how actions.ts's general-population
-- auto-scheduler now respects is_optional) — checked
-- private.patient_screen_interval_months's backing table,
-- condition_screen_cadences, directly first: it has exactly ONE row
-- (diabetes → hba1c). There is no chronic-pathway-specific cadence
-- configured for urine_acr at all, so a "pathway rolls forward regardless
-- of is_optional, general population doesn't" guard would be
-- indistinguishable from "never roll forward" for urine_acr specifically —
-- reintroducing the exact regression this migration exists to fix, just via
-- a different code path. Left refresh_screening_schedule_on_result and
-- refresh_screening_schedule_on_completion untouched. The real fix is
-- narrower: is_optional = true (stops the FIRST-TIME, never-engaged-before,
-- sex/age-only general-population auto-recommendation — the actual bug
-- reported) while is_active stays true (keeps every existing chronic-
-- pathway/recall/refresh mechanism working exactly as it always has). A
-- patient who has already had a urine ACR done — chronic-pathway-driven or
-- a one-off Comprehensive Screen purchase — continues to get the normal
-- next-cycle reminder, same as before; only a patient with zero prior
-- engagement stops being told it's "due" purely from being 18+.
--
-- (2) The COVID-19 vaccination_schedules cancellation in 20260922190610
-- matched status in ('pending','booked') while every other cancellation in
-- that same migration matched ('pending','booked','overdue') — and its own
-- closing assertion re-used the identical narrow filter, so it could not
-- have caught this gap. Confirmed live both COVID rows were 'pending' at
-- the time (zero actual impact), but the filter itself was wrong and is
-- corrected here for the next patient who might be 'overdue'.

update public.screen_types
set is_active = true,
    is_optional = true
where code = 'urine_acr';

-- No new pending/booked/overdue rows exist to cancel here — 20260922190610
-- already cancelled every one that existed, and is_optional = true doesn't
-- retroactively affect a row that's already resolved.

update public.vaccination_schedules vs
set status = 'cancelled',
    non_administration_note = 'COVID-19 vaccination removed from the platform catalogue — not part of Nigeria''s immunisation programme (2026-09-22).'
from public.vaccination_catalog vc
where vs.vaccination_catalog_id = vc.id
  and vc.code = 'covid_19'
  and vs.status = 'overdue';

do $$
declare
  v_bad_count integer;
begin
  if not exists (select 1 from public.screen_types where code = 'urine_acr' and is_active and is_optional) then
    raise exception 'FAIL: urine_acr should be is_active = true AND is_optional = true';
  end if;

  select count(*) into v_bad_count
  from public.vaccination_schedules vs
  join public.vaccination_catalog vc on vc.id = vs.vaccination_catalog_id
  where vc.code = 'covid_19' and vs.status in ('pending', 'booked', 'overdue');
  if v_bad_count <> 0 then
    raise exception 'FAIL: % pending/booked/overdue covid_19 vaccination_schedules row(s) remain', v_bad_count;
  end if;

  raise notice 'PASS: urine_acr corrected to is_active=true/is_optional=true (chronic-pathway recall/refresh preserved, general-population auto-recommendation still gated by is_optional); covid_19 vaccination_schedules fully cancelled including any overdue rows';
end $$;
