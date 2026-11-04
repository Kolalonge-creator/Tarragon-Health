-- Fixture, included with \ir by proofs that test the Membership Plus machinery (the upgrade order, the Plus renewal, Plus economics).
-- T2-09 (2026-11-04) stopped selling Plus and the upgrade and put the Membership at 100,000 naira. That machinery still exists for Plus
-- years bought earlier, so these proofs restore the pre-T2 catalogue INSIDE their own transaction (they all end in rollback):
-- Plus and the upgrade on sale again, the Membership back at 84,000 naira. now() is the transaction time, so the old row closes and the
-- new one opens at the same instant that private.current_price reads.
do $$
declare it public.catalog_items%rowtype;
begin
  update public.catalog_items set active = true where code in ('membership_annual', 'membership_upgrade_plus');
  select * into it from public.catalog_items where code = 'membership_annual_no_panel';
  update public.prices set valid_to = now()
   where catalog_item_id = it.id and valid_from < now() and (valid_to is null or valid_to > now());
  insert into public.prices (organisation_id, catalog_item_id, amount_kobo, components, valid_from, reason)
  values (it.organisation_id, it.id, 8400000, '{}'::jsonb, now(), 'proof fixture: the pre-T2 three-tier ladder (rolled back)');
end $$;
