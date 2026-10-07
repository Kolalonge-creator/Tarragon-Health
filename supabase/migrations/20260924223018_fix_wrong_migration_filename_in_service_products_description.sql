-- Typo fix: 20260924222401_retire_not_delete_weight_management_products.sql
-- was originally drafted at timestamp 20260924222254, applied under that
-- filename's own query text, then the local file was renamed to
-- 20260924222401 to match the version Postgres actually assigned it (per
-- this project's own "the version comes from wall-clock time at apply, not
-- the filename" lesson) -- but the three self-referencing description
-- strings it INSERTed into service_products still cited the old, pre-rename
-- name. Found independently by three /code-review high finder angles on
-- that migration's own diff.
--
-- Fixes the persisted data only; 20260924222401 itself is not re-edited
-- (never edit an already-applied migration in place).

begin;

update public.service_products
   set description = replace(
         description,
         '20260924222254_retire_not_delete_weight_management_products.sql',
         '20260924222401_retire_not_delete_weight_management_products.sql'
       )
 where code in ('weight_management_3m', 'weight_management_6m', 'weight_management_12m')
   and description like '%20260924222254_retire_not_delete_weight_management_products.sql%';

do $$
begin
  if exists (
    select 1 from public.service_products
     where code in ('weight_management_3m', 'weight_management_6m', 'weight_management_12m')
       and description like '%20260924222254%'
  ) then
    raise exception 'FAIL: a weight_management_* service_products description still cites the wrong filename';
  end if;

  if (
    select count(*) from public.service_products
     where code in ('weight_management_3m', 'weight_management_6m', 'weight_management_12m')
       and description like '%20260924222401_retire_not_delete_weight_management_products.sql%'
  ) <> 3 then
    raise exception 'FAIL: not all three weight_management_* descriptions cite the correct filename';
  end if;

  raise notice 'PASS: weight_management_3m/6m/12m descriptions now cite the correct migration filename';
end $$;

commit;
