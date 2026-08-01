-- Tarragon Health
-- Refill confirmation is a FLOOR, not a fence: any clinical tier may confirm
-- and continue an existing prescription.
--
-- private.can_confirm_medication_refill was written as `doctor_tier = 'tier_1'`
-- -- an equality, where every sibling authority gate in this codebase is a
-- minimum ("Tier 2 and above"). That made Tier 1 the ONLY holder of the
-- capability, so a Tier 4 Senior Registrar covering a shift with no Tier 1 on
-- duty had no route to confirm a routine refill. Founder decision 2026-08-01:
-- clinical authority must be MONOTONIC -- a higher tier can always do
-- everything a lower tier can, it simply has more on top.
--
-- Scope, deliberately narrow -- everything not listed is unchanged:
--   * ONLY widens who satisfies can_confirm_medication_refill.
--   * private.has_prescribing_authority is UNTOUCHED. Changing drug, dose,
--     frequency, schedule or active-status still requires Tier 2+ or the
--     Clinical Director, enforced by private.enforce_medication_confirm_only,
--     which is also untouched.
--   * 'care_coordinator' is EXCLUDED BY NAME. It is a value of the doctor_tier
--     enum but is explicitly non-clinical -- CLAUDE.md's standing rule is that
--     a Care Coordinator never gains write access to medications, escalation
--     resolution or protocol signing. Listing the five clinical tiers
--     explicitly, rather than `doctor_tier is not null`, is what keeps that
--     guarantee structural: a tier added to the enum later is excluded by
--     default rather than silently admitted.
--
-- Expected real-world delta is near zero, and that is the point rather than a
-- problem: Tier 2+ already passed medications_update's USING clause via
-- has_prescribing_authority, and enforce_medication_confirm_only early-returns
-- unrestricted for them. This migration makes the PREDICATE match the stated
-- authority model, so that packages/db/tests/tier_authority_monotonicity.sql
-- passes because the model is true and not by accident.
--
-- NOT fixed here, flagged rather than silently left:
--   1. The UI gate in apps/web/src/app/(dashboard)/clinician/patients/
--      [patientId]/page.tsx still computes
--      `!canPrescribe && doctor_tier === 'tier_1'`, so a Tier 2+ doctor still
--      sees no "Confirm & continue" control.
--   2. The last_confirmed_at / last_confirmed_by stamping inside
--      enforce_medication_confirm_only sits AFTER the prescriber early-return,
--      so a prescriber's confirmation is written but never attributed.
-- Both are app-layer changes and were deliberately left out of this migration's
-- scope. Until they land, this fixes the authority model but not the operator
-- experience of the no-Tier-1-on-shift case.

create or replace function private.can_confirm_medication_refill(org uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path to ''
as $function$
  select exists (
    select 1 from public.clinical_staff
    where profile_id = (select auth.uid())
      and organisation_id = org
      and active
      and (
        is_clinical_director
        or doctor_tier in (
          'tier_1',
          'tier_2',
          'tier_3',
          'tier_4_senior_registrar',
          'tier_5_partner_specialist'
        )
      )
  );
$function$;

-- The migration is the test: assert the new predicate is genuinely monotonic
-- across the five clinical tiers and still refuses a Care Coordinator, rather
-- than trusting the text above.
do $$
declare
  v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private' and p.proname = 'can_confirm_medication_refill';

  if v_def like '%care_coordinator%' then
    raise exception
      'can_confirm_medication_refill must never admit care_coordinator';
  end if;

  if v_def not like '%tier_5_partner_specialist%'
     or v_def not like '%tier_4_senior_registrar%'
     or v_def not like '%tier_3%'
     or v_def not like '%tier_2%'
     or v_def not like '%tier_1%' then
    raise exception
      'can_confirm_medication_refill must admit all five clinical tiers';
  end if;

  if v_def not like '%is_clinical_director%' then
    raise exception
      'can_confirm_medication_refill must admit the Clinical Director';
  end if;
end $$;
