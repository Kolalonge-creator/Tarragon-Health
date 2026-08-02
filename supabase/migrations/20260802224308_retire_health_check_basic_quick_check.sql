-- Retires the ₦15,000 "Quick Check" tier (health_check_basic). Founder
-- decision: the platform now has one cumulative Health Check ladder
-- (Core/Advanced/Comprehensive), no separate cheaper entry point below it.
-- Deactivated, not deleted — same convention as annual_health_check /
-- health_check_comprehensive's own retirement (20260802010000): a real
-- lab_tests/panel_bundles row that existed and may have real order history
-- is never dropped, only is_active=false so it stops being offered.
update public.panel_bundles
  set is_active = false
  where code = 'health_check_basic';

do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.panel_bundles
    where code = 'health_check_basic' and is_active = true;
  if v_count > 0 then
    raise exception 'health_check_basic should be retired (is_active=false)';
  end if;
end $$;
