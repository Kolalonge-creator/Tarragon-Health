-- S54b: the S28 chooser (the list a patient sees and the check when she picks) follows the same quality rule as the price comparison and
-- the routing trigger: a pharmacy is listed only with a verified, unexpired licence AND a recorded NAFDAC-source attestation.
-- Sorted after the S28c migration (20261007141623) on purpose: it edits, in place and from whatever definition is current, the two
-- functions that carry the rule today: `private.pharmacy_location_choosable(uuid,uuid)` (the check when she picks, which
-- `patient_choose_pharmacy` calls) and `public.patient_collection_pharmacies(uuid,uuid)` (the list). S28c replaced the first-S28 chooser
-- functions, so the older signatures no longer exist. Fail closed: if either function is missing or has no recognisable licence filter,
-- this migration raises rather than leaving the chooser on the weaker rule.
do $$
declare
  v_fn text;
  v_def text;
  v_old text := 'pp.is_active and pp.approved_at is not null and pp.license_verified_at is not null';
  v_new text := 'pp.is_active and pp.approved_at is not null and pp.license_verified_at is not null and pp.nafdac_source_attested_at is not null';
  v_n integer := 0;
begin
  foreach v_fn in array array['private.pharmacy_location_choosable(uuid,uuid)', 'public.patient_collection_pharmacies(uuid,uuid)'] loop
    if to_regprocedure(v_fn) is null then
      raise exception 'S54b: % is missing; the S28c migration must run first', v_fn;
    end if;
    v_def := pg_get_functiondef(to_regprocedure(v_fn));
    if v_def like '%nafdac_source_attested_at%' then continue; end if;
    if position(v_old in v_def) = 0 then
      raise exception 'S54b: % has no recognisable licence filter; add the NAFDAC attestation condition by hand', v_fn;
    end if;
    execute replace(v_def, v_old, v_new);
    v_n := v_n + 1;
  end loop;
  raise notice 'S54b: % function(s) now follow the NAFDAC-source rule', v_n;
end $$;

do $$
begin
  if pg_get_functiondef('private.pharmacy_location_choosable(uuid,uuid)'::regprocedure) not like '%nafdac_source_attested_at%'
     or pg_get_functiondef('public.patient_collection_pharmacies(uuid,uuid)'::regprocedure) not like '%nafdac_source_attested_at%' then
    raise exception 'FAIL: the chooser does not follow the NAFDAC-source rule';
  end if;
end $$;
