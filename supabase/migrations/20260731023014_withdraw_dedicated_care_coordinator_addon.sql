-- Withdraw the Dedicated Care Coordinator add-on.
--
-- Two independent reasons, either of which is sufficient.
--
-- 1. It sold something that will not exist. The add-on's own description
--    promises "one named coordinator" assigned to one patient. The founder
--    confirmed on 2026-07-31 that the operating model will not include
--    dedicated per-patient staff, so this cannot be delivered.
--
-- 2. It already delivered nothing. Its feature key, dedicated_coordinator, is
--    granted by this add-on alone (no subscription_plans row carries it) and is
--    read by exactly zero code paths: the only occurrence anywhere in the
--    codebase is a placeholder string in an admin form. Anyone who had bought
--    it would have been charged ₦30,000 monthly and unlocked no behaviour at
--    all. Same dead-key class as prevention_coordination, found and wired up on
--    2026-07-23.
--
-- Zero subscription_add_ons rows reference either row, verified before applying,
-- so nobody is mid-subscription and no billing needs unwinding.
--
-- Deactivated rather than deleted. The row is history: it records a price that
-- was live, and deletion would also strand the Paystack Plan and Stripe Price
-- objects with no local trace of what they were for. Deactivation is the
-- established convention here and is reversible if an automated, staff-free
-- version of this is ever built. seed.sql drops the rows outright in the same
-- change, so a rebuilt environment never resurrects them.
update public.add_ons
   set is_active = false
 where code in ('care-coordinator', 'care-coordinator_usd');

do $$
declare
  v_active int;
  v_subscribed int;
begin
  select count(*) into v_active
    from public.add_ons
   where code in ('care-coordinator', 'care-coordinator_usd')
     and is_active;
  if v_active <> 0 then
    raise exception 'the coordinator add-on must not remain purchasable (% still active)', v_active;
  end if;

  select count(*) into v_subscribed
    from public.subscription_add_ons sa
    join public.add_ons a on a.id = sa.add_on_id
   where a.code in ('care-coordinator', 'care-coordinator_usd');
  if v_subscribed <> 0 then
    raise exception
      'withdrawing an add-on with % live subscription(s) would leave people billed for it', v_subscribed;
  end if;
end $$;
