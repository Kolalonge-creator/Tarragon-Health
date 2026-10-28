-- S61 / journey 1 (owner decision 2026-10-28): a Free patient whose 7-day blood pressure average is above target is offered Membership.
-- The journey called it "the hypertension care pack"; the catalog has no such item any more (Membership replaced it), so the offer is
-- membership_annual. This adds ONE read function and no table, no price and no switch of its own:
--   * it sits behind the existing checkout_enabled guard (nothing is offered while there is nothing to buy; a test account passes it, like every guard);
--   * "above target" is the risk engine's own line (risk_config.above_target margins, the 7 day window and min_readings), not a new number;
--   * a current Member gets no sales offer (their doctor task already exists); a Free patient is the only audience;
--   * pregnancy, the weeks after a birth, under 18 and dependent accounts get no offer (clinician-led, reason clinician_led);
--   * it never charges, never sends a message, and reads only the caller's own readings.
-- Row count before this migration: no table is created or changed.
create function public.my_membership_offer() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  c jsonb := (select config from public.risk_config where is_active);
  v_win integer := (c ->> 'bp_window_days')::integer;
  v_min integer := (c ->> 'min_readings')::integer;
  v_today date := private.lagos_today();
  t record; s record; v_price bigint; v_item uuid;
begin
  if v_me is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if not private.go_live_open_patient('checkout_enabled', v_me) then
    return jsonb_build_object('status', 'not_open_yet');
  end if;
  if private.risk_is_current_member(v_me, now()) then
    return jsonb_build_object('status', 'not_eligible', 'reason', 'already_member');
  end if;
  -- Pregnancy, the weeks after a birth, a child and a dependent account are led by a clinician (the rule set routes them), never by a sales message.
  if exists (select 1 from public.profiles pr where pr.id = v_me and (coalesce(pr.is_pregnant, false) or coalesce(pr.is_dependent_account, false)))
     or coalesce(private.patient_age_years(v_me), 0) < 18
     or private.bp_is_postpartum(v_me, now(), '{}'::jsonb) then
    return jsonb_build_object('status', 'not_eligible', 'reason', 'clinician_led');
  end if;
  select * into t from private.patient_bp_target(v_me);
  select * into s from private.bp_window_stats(v_me, v_today - (v_win - 1), v_today);
  if coalesce(s.n, 0) < v_min then
    return jsonb_build_object('status', 'not_eligible', 'reason', 'too_few_readings', 'readings', coalesce(s.n, 0), 'needed', v_min);
  end if;
  if not (s.avg_sys >= t.sys + (c #>> '{above_target,systolic}')::integer or s.avg_dia >= t.dia + (c #>> '{above_target,diastolic}')::integer) then
    return jsonb_build_object('status', 'not_eligible', 'reason', 'within_target', 'readings', s.n);
  end if;
  select ci.id into v_item from public.catalog_items ci where ci.code = 'membership_annual' and ci.active;
  if v_item is not null then
    select p.amount_kobo into v_price from public.prices p
     where p.catalog_item_id = v_item and p.valid_from <= now() and (p.valid_to is null or p.valid_to > now())
     order by p.valid_from desc limit 1;
  end if;
  return jsonb_build_object('status', 'offer', 'catalog_item', 'membership_annual', 'price_kobo', v_price,
    'window_days', v_win, 'readings', s.n, 'avg_systolic', round(s.avg_sys), 'avg_diastolic', round(s.avg_dia),
    'target_systolic', t.sys, 'target_diastolic', t.dia);
end $$;
revoke all on function public.my_membership_offer() from public, anon;
grant execute on function public.my_membership_offer() to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.my_membership_offer()', 'EXECUTE') then raise exception 'my_membership_offer self-check: anon can execute it'; end if;
  if not has_function_privilege('authenticated', 'public.my_membership_offer()', 'EXECUTE') then raise exception 'my_membership_offer self-check: signed-in users cannot execute it'; end if;
end $$;
