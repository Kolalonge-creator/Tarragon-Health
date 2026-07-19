-- Health Education add-on: pricing.ts says it's available "on Essential Care
-- or Tarragon Free", but restricted_to_plan_code was pinned to the essential
-- plan (a single code can't express "essential OR free"), so Free patients
-- couldn't attach it despite the marketing. Unrestrict it (null = any plan),
-- matching the sibling Lifestyle Coaching add-on which is already unrestricted
-- and carries the same "add-on on Essential or Free" availability.
--
-- Idempotent: only nulls the three health-education variants.
update public.add_ons
set restricted_to_plan_code = null
where code in ('health-education', 'health-education_gbp', 'health-education_usd')
  and restricted_to_plan_code is not null;
