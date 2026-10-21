-- ===========================================================================
-- Proof: *_oq714_remove_patient_price_compare.sql (OQ-714, v5 spec Part C.2, OQ-283).
--
-- The patient collection flow shows no price comparison. This proves, against the real migrated schema:
--   1. no function named patient_price_compare exists in any schema, and calling it as a signed-in patient or as anon is an
--      "undefined function" error (42883), not a refusal and not an empty table;
--   2. THE GATE STILL OPENS: what the collection flow needs after the removal is still there and still works: the patient chooser
--      function (executable by authenticated, never anon), the care-team suggestion read, the shared matcher (an empty prescription
--      matches nothing, no error), the listable-pharmacy rule (an unknown pharmacy is not listable), the routing and verified-batch
--      triggers, and the catalogue columns the pharmacy portal and the older order path use (price_kobo, stock_status, verified_batch);
--   3. SABOTAGE: planting a function with the retired name makes check 1's own query find it, so check 1 is not vacuous.
--
-- Wrapped in BEGIN/ROLLBACK; creates no fixture rows.
-- Run:  psql -f packages/db/tests/oq714_remove_patient_price_compare.sql  (CI: scripts/run-db-proofs.sh)
-- ===========================================================================

begin;

create function pg_temp.price_compare_functions() returns bigint language sql as
$$ select count(*) from pg_proc where proname = 'patient_price_compare' $$;

do $$
declare
  v_state text;
  v_n bigint;
begin
  -- ====== 1. Gone, and a call is "no such function" ===========================
  if pg_temp.price_compare_functions() <> 0 then
    raise exception 'FAIL 1: a function named patient_price_compare still exists';
  end if;
  set local role authenticated;
  begin
    perform 1 from public.patient_price_compare('00000000-0000-4000-8000-000000000000'::uuid);
    v_state := 'returned';
  exception when others then v_state := sqlstate; end;
  reset role;
  if v_state is distinct from '42883' then raise exception 'FAIL 1: authenticated call gave % (expected 42883)', v_state; end if;
  set local role anon;
  begin
    perform 1 from public.patient_price_compare('00000000-0000-4000-8000-000000000000'::uuid);
    v_state := 'returned';
  exception when others then v_state := sqlstate; end;
  reset role;
  if v_state is distinct from '42883' then raise exception 'FAIL 1: anon call gave % (expected 42883)', v_state; end if;

  -- ====== 2. What stays, stays and works =====================================
  if to_regprocedure('public.patient_collection_pharmacies(uuid,uuid)') is null
     or to_regprocedure('public.patient_pharmacy_suggestion(uuid)') is null
     or to_regprocedure('public.medication_refill_pharmacy(uuid)') is null then
    raise exception 'FAIL 2: a collection-flow function is missing';
  end if;
  if not has_function_privilege('authenticated', 'public.patient_collection_pharmacies(uuid,uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.patient_collection_pharmacies(uuid,uuid)', 'EXECUTE') then
    raise exception 'FAIL 2: the chooser function lost its authenticated grant or gained an anon one';
  end if;
  select count(*) into v_n from private.pharmacy_item_matches('[]'::jsonb);
  if v_n <> 0 then raise exception 'FAIL 2: the shared matcher returned % rows for an empty prescription', v_n; end if;
  if private.pharmacy_partner_listable(gen_random_uuid()) then
    raise exception 'FAIL 2: an unknown pharmacy is listable';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'prescriptions_listable_pharmacy' and not tgisinternal)
     or not exists (select 1 from pg_trigger where tgname = 'pharmacy_medications_verified_batch_guard' and not tgisinternal) then
    raise exception 'FAIL 2: a quality trigger (listable routing or verified batch) is missing';
  end if;
  select count(*) into v_n from information_schema.columns
   where table_schema = 'public' and table_name = 'pharmacy_medications' and column_name in ('price_kobo', 'stock_status', 'verified_batch');
  if v_n <> 3 then raise exception 'FAIL 2: % of 3 catalogue columns present', v_n; end if;

  -- ====== 3. SABOTAGE: the retired name comes back; check 1's query sees it ==
  create function public.patient_price_compare(p_prescription uuid) returns integer language sql as 'select 1';
  if pg_temp.price_compare_functions() <> 1 then
    raise exception 'FAIL 3: sabotage did not register, so check 1 would pass vacuously';
  end if;
  begin
    perform public.patient_price_compare(gen_random_uuid());
    raise notice 'sabotage: a function by the retired name is callable again, and check 1 would have FAILED';
  end;

  raise notice 'PASS: oq714 patient price comparison removed; collection flow, quality rules and catalogue columns intact';
end $$;

rollback;
