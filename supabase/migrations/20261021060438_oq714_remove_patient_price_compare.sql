-- OQ-714 (v5 spec Part C.2, OQ-283): the patient collection flow shows no price and no price comparison. Removes S54's
-- `public.patient_price_compare(uuid)`, the one database object behind the comparison table on /patient/pharmacy/collect/[id].
-- Pattern: count-first removal. Live counts on koiplnmbgnqnbywhpjlf, 2026-10-21, before this change:
--   pharmacy_medications                         0 rows (0 with a price, 0 with verified_batch set)
--   pharmacy_partners with a NAFDAC attestation  0 rows
--   other functions, views or policies whose source or definition names patient_price_compare   0
--   pg_depend dependents of the function                                                       0
-- Nothing stored depends on the comparison, so there is nothing to convert; this is a structural change only. The function is also
-- not an enum value or a column, so there is no enum member to delete: the comparison could only grow back as a function, and a
-- test (packages/db/tests/oq714_remove_patient_price_compare.sql) fails if one by that name returns.
--
-- REMOVED
--   patient SELECT grant on pharmacy_medications.verified_batch and verified_batch_at (S54 granted it only for the comparison)
--   function public.patient_price_compare(uuid) (S54 20261007210010, last redefined in S54c 20261007210012 to read the shared matcher)
-- (The web page, loader, row schema and the pharmprice.* strings were removed in the same pull request, shipped first.)
--
-- DELIBERATELY KEPT, each used by something that stays:
--   pharmacy_medications.price_kobo, stock_status, stock_updated_at: the pharmacy portal catalogue and the older pay-through order path
--     (pharmacy_orders.total_kobo), and the clinician-side stock flag (S54c). Spec C.2 removes the patient-facing comparison, not the catalogue.
--   pharmacy_medications.verified_batch (+ _at, _by) and the NAFDAC-source attestation (only the patient SELECT grant on the flag is revoked, above): partner quality (S54 8.11 / S74), enforced by
--     private.pharmacy_partner_listable on every prescription routing. It is unrelated to showing a price.
--   private.pharmacy_item_matches and private.pharmacy_name_key: the shared matcher the clinician's stock flag and suggestion still use.
--   S28e stock confirmation (a plain yes or no, no price), the pharmacy visit and scorecard, pharmacist chat, dependants: untouched.
--
-- Ship order: the web change is safe against the old schema (it never calls the function), and an old deployment that still called it
-- shows "could not load prices" and the chooser below it, so this migration is applied second.

drop function public.patient_price_compare(uuid);

-- The patient read grant on the verified-batch flag existed only so the comparison could say "checked by Tarragon staff". Nothing a patient
-- sees reads it now (admin and partner managers read it through public.pharmacy_medications_admin, which runs as its owner; writes use the
-- separate INSERT/UPDATE column grants and the staff-only guard trigger). Verified live 2026-10-21: no web query selects either column from
-- the table.
revoke select (verified_batch, verified_batch_at) on public.pharmacy_medications from authenticated;

do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'patient_price_compare') then
    raise exception 'FAIL: patient_price_compare is still there';
  end if;
  -- what stays must stay
  if to_regprocedure('public.patient_collection_pharmacies(uuid,uuid)') is null
     or to_regprocedure('public.patient_pharmacy_suggestion(uuid)') is null
     or to_regprocedure('private.pharmacy_item_matches(jsonb)') is null
     or to_regprocedure('private.pharmacy_partner_listable(uuid)') is null
     or to_regprocedure('public.medication_refill_pharmacy(uuid)') is null then
    raise exception 'FAIL: a function the collection flow still needs was dropped';
  end if;
  if (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'pharmacy_medications'
        and column_name in ('price_kobo', 'stock_status', 'verified_batch')) <> 3 then
    raise exception 'FAIL: a catalogue column that stays was dropped';
  end if;
  if has_column_privilege('authenticated', 'public.pharmacy_medications', 'verified_batch', 'SELECT')
     or has_column_privilege('authenticated', 'public.pharmacy_medications', 'verified_batch_at', 'SELECT') then
    raise exception 'FAIL: a signed-in user can still read the verified-batch columns from the table';
  end if;
  raise notice 'PASS: patient price comparison removed, collection, stock, quality and matcher intact';
end $$;
