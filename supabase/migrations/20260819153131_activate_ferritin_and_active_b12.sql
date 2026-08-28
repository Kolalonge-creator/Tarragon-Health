update public.screen_types
set is_active = true
where code in ('ferritin', 'active_b12');

update public.panel_bundles
set test_codes = test_codes || array['ferritin', 'active_b12']::text[]
where code = 'screen_comprehensive'
  and not ('ferritin' = any(test_codes))
  and not ('active_b12' = any(test_codes));

do $$
begin
  if not exists (select 1 from public.screen_types where code = 'ferritin' and is_active = true) then
    raise exception 'FAIL: ferritin not active';
  end if;
  if not exists (select 1 from public.screen_types where code = 'active_b12' and is_active = true) then
    raise exception 'FAIL: active_b12 not active';
  end if;
  if not exists (
    select 1 from public.panel_bundles
    where code = 'screen_comprehensive'
      and 'ferritin' = any(test_codes)
      and 'active_b12' = any(test_codes)
  ) then
    raise exception 'FAIL: ferritin/active_b12 not both in screen_comprehensive.test_codes';
  end if;
  raise notice 'PASS: ferritin and active_b12 are active and in screen_comprehensive';
end $$;
