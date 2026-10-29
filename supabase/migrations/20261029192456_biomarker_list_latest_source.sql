-- patient_biomarker_list now says where the LATEST value of each test came from (latest_source). The patient's trend page grades the
-- latest value against the CMO's bands and draws a range bar; that must never be done for a number nobody has reviewed
-- (source 'patient_reported', migration 20261029192438), and the list did not carry the source. Additive key: every existing reader
-- of the list ignores it. Spliced into the LIVE body, like the migration before it.
do $$
declare
  v_list text := pg_get_functiondef('public.patient_biomarker_list(uuid)'::regprocedure);
begin
  if position('latest_source' in v_list) = 0 then
    v_list := regexp_replace(v_list, '''latest_ref_text''\s*,\s*c\.latest_ref_text\)', '''latest_ref_text'', c.latest_ref_text, ''latest_source'', c.latest_source)');
    v_list := regexp_replace(v_list, '(\(array_agg\(p\.ref_text order by p\.taken_at desc\)\)\[1\]\s+latest_ref_text)', '\1, (array_agg(p.source order by p.taken_at desc))[1] latest_source');
    if (length(v_list) - length(replace(v_list, 'latest_source', ''))) / length('latest_source') <> 3 then
      raise exception 'patient_biomarker_list no longer has the shape this migration patches; re-read it before editing';
    end if;
    execute v_list;
  end if;
end $$;

do $$
begin
  if position('latest_source' in pg_get_functiondef('public.patient_biomarker_list(uuid)'::regprocedure)) = 0 then
    raise exception 'patient_biomarker_list was not patched';
  end if;
end $$;
