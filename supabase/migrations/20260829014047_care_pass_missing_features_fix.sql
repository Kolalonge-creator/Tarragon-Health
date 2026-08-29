-- Tarragon Health — fix: Care Pass was missing two features the retired
-- tiers granted, found auditing packages/db/tests/gate_second_condition_
-- review_to_complete_care.sql against Care Pass's actual features array
-- (20260829011710_retire_tiers_and_care_pass.sql) before assuming that
-- migration's "full union of what the three tiers offered between them"
-- claim was actually true.
--
-- vitals_red_flag_doctor_escalation is the serious one: per
-- 20260810022401_gate_vitals_red_flag_escalation_to_paid_plans.sql, this
-- is what gates whether a dangerous vitals reading (BP/SpO2/temperature)
-- pages a clinician at all — granted to EVERY paid tier (prevent%,
-- essential%, complete%), never Complete-exclusive. Without this fix, a
-- Care Pass patient would have silently had the same doctor-escalation
-- behaviour as Tarragon Free for a dangerous reading, despite paying for
-- full chronic-care cover — a patient-safety-adjacent regression, not a
-- cosmetic gap.
--
-- multi_condition_review (20260810023507_gate_second_condition_review_to_
-- complete_care.sql) is Complete-only: without it, a Care Pass patient
-- managing two conditions concurrently would get a scheduled review for
-- their first condition only, and a one-time "upgrade" nudge for the
-- second — pointing at a Complete Care tier that no longer exists.

update public.subscription_plans
   set features = (select array(select distinct unnest(
         coalesce(features, '{}') || array['vitals_red_flag_doctor_escalation', 'multi_condition_review']
       )))
 where code in ('care_pass_12mo', 'care_pass_6mo')
   and not (
     'vitals_red_flag_doctor_escalation' = any(coalesce(features, '{}'))
     and 'multi_condition_review' = any(coalesce(features, '{}'))
   );

do $$
declare v_missing text;
begin
  select string_agg(code, ', ') into v_missing
  from public.subscription_plans
  where code in ('care_pass_12mo', 'care_pass_6mo')
    and (
      not ('vitals_red_flag_doctor_escalation' = any(coalesce(features, '{}')))
      or not ('multi_condition_review' = any(coalesce(features, '{}')))
    );
  if v_missing is not null then
    raise exception 'FAIL: Care Pass plans still missing a feature: %', v_missing;
  end if;
end $$;
