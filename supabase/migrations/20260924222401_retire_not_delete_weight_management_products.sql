-- Correction to 20260924220239_remove_supervised_weight_management.sql: the
-- three service_products/service_delivery_cost_model rows should have been
-- retired, not deleted. Found by /code-review high on that migration's own
-- diff before it merged.
--
-- THE MISTAKE
-- -----------
-- 20260924220239 hard-DELETEd weight_management_3m/6m/12m from
-- service_products and their rows from service_delivery_cost_model,
-- reasoning from this platform's "delete the enum VALUE, not just the
-- app-code path" removal convention. That convention is about an enum value
-- reachable from user input growing back silently; a service_products row is
-- a different kind of object, and this platform already has a live, explicit
-- precedent for retiring one two weeks earlier:
-- 20260910014006_unbundle_chronic_pack.sql deactivates
-- chronic_doctor_supported_pack (`is_active = false`, a "Retired ..."
-- description) rather than deleting it, specifically "so any historical
-- reference reads as a retired product rather than a missing one" -- and
-- never touches its service_delivery_cost_model row at all.
-- service_delivery_cost_model's own table comment
-- (20260910011854_service_delivery_cost_model.sql) says exactly why:
-- "Keyed on service_products.code by TEXT rather than a foreign key so a
-- retired product keeps its costing for historical margin analysis instead
-- of disappearing from the record." Deleting these rows worked against that
-- table's stated design intent, not merely against a convention.
--
-- Zero purchases ever existed against these three codes (verified live
-- before the original migration ran), so nothing was stranded and no
-- ON DELETE RESTRICT fired -- this is a lost audit trail, not a data-
-- integrity bug. apps/web/src/lib/queries/service-products.ts's
-- useAllServiceProductsAdmin() ("Every service product, any currency/active
-- state -- admin management view") is the concrete surface this cost:
-- chronic_doctor_supported_pack shows up there as a retired product;
-- weight_management_3m/6m/12m would show up as nothing at all, forever,
-- with no way to answer "did we ever sell this and why did it stop" short of
-- reading migration files.
--
-- THE FIX
-- -------
-- Re-insert the three service_products rows exactly as originally priced,
-- with is_active = false and a retirement note matching
-- chronic_doctor_supported_pack's own shape, and re-insert their
-- service_delivery_cost_model rows unchanged. Nothing else from 20260924220239
-- is reversed: the tables/RPCs/trigger functions/enum/RLS policies stay
-- dropped, and clinical_encounters and chronic_condition_programmes.obesity
-- stay reverted to their free-programme shape. Only the two rows that should
-- never have been deleted come back, deactivated.

begin;

insert into public.service_products
  (code, name, description, price_kobo, currency, access_duration_days, features, is_active)
values
  ('weight_management_3m',
   'Supervised Weight Management, 3 months',
   'Retired 2026-09-24 and removed from sale. This row is kept, deactivated, so a historical reference reads as a retired product rather than a missing one -- see 20260924220239_remove_supervised_weight_management.sql and 20260924222254_retire_not_delete_weight_management_products.sql for why.',
   7500000, 'NGN', 90,
   array['weight_management_supervised', 'vitals_red_flag_doctor_escalation',
         'clinician_review', 'doctor_checkin', 'async_doctor_visit',
         'result_document_review'], false),

  ('weight_management_6m',
   'Supervised Weight Management, 6 months',
   'Retired 2026-09-24 and removed from sale. This row is kept, deactivated, so a historical reference reads as a retired product rather than a missing one -- see 20260924220239_remove_supervised_weight_management.sql and 20260924222254_retire_not_delete_weight_management_products.sql for why.',
   13200000, 'NGN', 180,
   array['weight_management_supervised', 'vitals_red_flag_doctor_escalation',
         'clinician_review', 'doctor_checkin', 'async_doctor_visit',
         'result_document_review'], false),

  ('weight_management_12m',
   'Supervised Weight Management, 12 months',
   'Retired 2026-09-24 and removed from sale. This row is kept, deactivated, so a historical reference reads as a retired product rather than a missing one -- see 20260924220239_remove_supervised_weight_management.sql and 20260924222254_retire_not_delete_weight_management_products.sql for why.',
   24000000, 'NGN', 365,
   array['weight_management_supervised', 'vitals_red_flag_doctor_escalation',
         'clinician_review', 'doctor_checkin', 'async_doctor_visit',
         'result_document_review'], false)

on conflict (code) do update
  set name        = excluded.name,
      description = excluded.description,
      is_active   = false;

insert into public.service_delivery_cost_model
  (service_product_code, component, expected_minutes, delivered_by_tier, coordination_minutes, units_per_term, notes)
values
  ('weight_management_3m', 'delivery',  30, 'senior_medical_officer', 20, 4.0,
   'Eligibility assessment plus 3 monthly reviews; coordinator handles fortnightly check-in chasing. Retired 2026-09-24; kept for historical margin analysis.'),
  ('weight_management_6m', 'delivery',  30, 'senior_medical_officer', 20, 7.0,
   'Eligibility plus 6 monthly reviews. Retired 2026-09-24; kept for historical margin analysis.'),
  ('weight_management_12m', 'delivery', 30, 'senior_medical_officer', 20, 13.0,
   'Eligibility plus 12 monthly reviews. Retired 2026-09-24; kept for historical margin analysis.')
on conflict (service_product_code, component) do nothing;

-- ---------------------------------------------------------------------------
-- Assertions
-- ---------------------------------------------------------------------------

do $$
declare
  v_active_count int;
  v_products_count int;
  v_cost_rows int;
begin
  select count(*) into v_products_count
    from public.service_products
   where code in ('weight_management_3m', 'weight_management_6m', 'weight_management_12m');
  if v_products_count <> 3 then
    raise exception 'FAIL: expected 3 weight_management_* service_products rows (retired), found %', v_products_count;
  end if;

  select count(*) into v_active_count
    from public.service_products
   where code in ('weight_management_3m', 'weight_management_6m', 'weight_management_12m')
     and is_active;
  if v_active_count <> 0 then
    raise exception 'FAIL: a weight_management_* service_products row is still is_active';
  end if;

  select count(*) into v_cost_rows
    from public.service_delivery_cost_model
   where service_product_code in ('weight_management_3m', 'weight_management_6m', 'weight_management_12m');
  if v_cost_rows <> 3 then
    raise exception 'FAIL: expected 3 weight_management_* service_delivery_cost_model rows, found %', v_cost_rows;
  end if;

  raise notice 'PASS: weight_management_3m/6m/12m are retired (is_active=false, resolvable), matching chronic_doctor_supported_pack''s own retirement shape -- not deleted';
end $$;

commit;
