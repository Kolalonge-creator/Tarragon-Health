-- Patient-facing plan-card copy (subscription_plans.description, rendered
-- directly by apps/web's PlanSelector — separate from the marketing site's
-- static pricing.ts, which was fixed in the same 2026-07-30 pass) still
-- promised WhatsApp as the care-team contact channel. Two-way patient<->
-- care-team conversation is in-app only now (see care_messages,
-- 20260719110000, and the founder direction recorded in CLAUDE.md).
update public.subscription_plans
set description = 'One condition: monthly doctor review, monthly doctor check-in, care team messaging in the app.'
where code in ('essential', 'essential_usd')
  and description = 'One condition: monthly doctor review, monthly doctor check-in, WhatsApp care team access.';

do $$
declare
  v_bad int;
begin
  select count(*) into v_bad from public.subscription_plans
    where is_active = true and (description ilike '%whatsapp%' or description ilike '%named doctor%' or description ilike '%named clinician%');
  if v_bad > 0 then
    raise exception 'still % active subscription_plans rows with stale messaging/continuity copy', v_bad;
  end if;
end $$;
