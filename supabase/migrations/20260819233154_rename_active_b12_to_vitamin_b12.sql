update public.screen_types
set code = 'vitamin_b12', name = 'Vitamin B12'
where code = 'active_b12';

update public.panel_bundles
set test_codes = array_replace(test_codes, 'active_b12', 'vitamin_b12')
where 'active_b12' = any(test_codes);

do $$
begin
  if exists (select 1 from public.screen_types where code = 'active_b12') then
    raise exception 'FAIL: active_b12 still present after rename';
  end if;
  if not exists (select 1 from public.screen_types where code = 'vitamin_b12' and is_active = true) then
    raise exception 'FAIL: vitamin_b12 missing or not active';
  end if;
  if exists (
    select 1 from public.panel_bundles where 'active_b12' = any(test_codes)
  ) then
    raise exception 'FAIL: a bundle still references active_b12';
  end if;
  if not exists (
    select 1 from public.panel_bundles
    where code = 'screen_comprehensive' and 'vitamin_b12' = any(test_codes)
  ) then
    raise exception 'FAIL: screen_comprehensive missing vitamin_b12';
  end if;
  raise notice 'PASS: active_b12 renamed to vitamin_b12 in screen_types and panel_bundles';
end $$;
