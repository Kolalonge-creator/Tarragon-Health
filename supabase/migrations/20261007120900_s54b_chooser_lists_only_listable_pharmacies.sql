-- S54b: the S28 chooser (the list a patient sees and the check when she picks) follows the same quality rule as the price comparison and
-- the routing trigger: a pharmacy is listed only with a verified, unexpired licence AND a recorded NAFDAC-source attestation.
-- Sorted after the S28 migration (20261007120114) on purpose: it edits that migration's two functions in place, from whatever definition
-- is current. If S28's functions are absent (a branch without S28) there is nothing to edit and the routing trigger from the S54
-- migration still refuses an unlisted pharmacy, so this is a notice and not an error.
do $$
declare
  v_fn text;
  v_def text;
  v_old text := 'pp.is_active and pp.approved_at is not null and pp.license_verified_at is not null';
  v_new text := 'pp.is_active and pp.approved_at is not null and pp.license_verified_at is not null and pp.nafdac_source_attested_at is not null';
  v_n integer := 0;
begin
  foreach v_fn in array array['public.patient_collection_pharmacies(uuid)', 'public.patient_choose_pharmacy(uuid,uuid,uuid)'] loop
    if to_regprocedure(v_fn) is null then
      raise notice 'S54b: % not present, nothing to edit', v_fn;
      continue;
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
