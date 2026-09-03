-- single_tft now buys TSH + Free T4 (not Synlab's bundled Thyroid Function
-- Profile, which includes Free T3). Update the product copy to match, same
-- naming-honesty fix as the syphilis(RPR) rename in the phase 1+3 migration.
update public.panel_bundles
   set name = 'Thyroid Function (TSH, Free T4)',
       description = 'TSH and Free T4 -- the two tests this screen actually promises. Checks how your thyroid is working.'
 where code = 'single_tft';

do $$
begin
  if (select name from public.panel_bundles where code = 'single_tft') <> 'Thyroid Function (TSH, Free T4)' then
    raise exception 'FAIL: single_tft name not updated';
  end if;
end $$;
