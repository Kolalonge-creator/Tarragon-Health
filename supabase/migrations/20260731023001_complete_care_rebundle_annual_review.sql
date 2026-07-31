-- Reverts complete_care_unbundle_annual_review (same session, minutes
-- earlier). Founder decision 2026-07-31: Annual Doctor Review stays bundled
-- into Complete Care after all — its only real marginal cost is doctor
-- time, which Complete Care's price is already sized to absorb (weekly
-- review + priority escalation + multi-condition coordination already
-- assume real recurring doctor time at this tier). Unlike the Annual Health
-- Check (a full external screening day, genuinely separate variable cost),
-- the Doctor Review is closer in kind to the review work Complete already
-- includes, just once a year and deeper.
--
-- Zero live impact either direction: still 0 active subscriptions on any
-- complete/complete_yearly/complete_usd/complete_yearly_usd plan (unchanged
-- since the unbundle migration a few minutes ago). No price touched.

update public.subscription_plans
set features = array_append(features, 'annual_review')
where code in ('complete', 'complete_yearly', 'complete_usd', 'complete_yearly_usd')
  and not ('annual_review' = any(features));

do $$
declare
  v_missing int;
begin
  select count(*) into v_missing
  from public.subscription_plans
  where code in ('complete', 'complete_yearly', 'complete_usd', 'complete_yearly_usd')
    and not ('annual_review' = any(features));
  if v_missing <> 0 then
    raise exception 'complete_care_rebundle_annual_review: % Complete Care plan row(s) still missing annual_review', v_missing;
  end if;
end $$;
;
