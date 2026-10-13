-- S05b-b: every lab value says where its reference range came from.
--
-- Founder decision 2026-10-13: a displayed range is labelled with its source (the lab report, a named guideline, or a CMO-signed
-- configuration row). An unlabelled range, or an "optimal" range presented as clinical, is never shown.
--
-- Live check first (project koiplnmbgnqnbywhpjlf, read only, 2026-10-13): the two tables that hold lab values with a range are
--   * public.lab_analyte_readings   (reference_range_low / high / text; 0 rows)
--   * public.lab_result_items       (ref_low / ref_high, written by private.submit_lab_result from the CMO-signed panel version; 0 rows)
-- and public.lab_panel_signoffs has 2 rows, 1 signed and active. Ranges also reach the shared-record page through
-- public.record_share_by_token and the patient and clinician screens through public.my_lab_results() and public.lab_result_for_review().
-- With 0 rows in both tables there is nothing to backfill; the column default says "unspecified", which the screens print as
-- "Range not specified".
--
-- range_source values: lab_report, guideline, cmo_signed_config, unspecified. range_source_ref names the guideline or the signed row.

-- 1. lab_analyte_readings: a stored range MUST declare its source (no auto-guessing: a writer that has a range says where it is from).
alter table public.lab_analyte_readings
  add column range_source text not null default 'unspecified'
    check (range_source in ('lab_report', 'guideline', 'cmo_signed_config', 'unspecified')),
  add column range_source_ref text,
  add constraint lab_analyte_readings_range_needs_source check (
    range_source <> 'unspecified'
    or (reference_range_low is null and reference_range_high is null and reference_range_text is null)
  ),
  add constraint lab_analyte_readings_named_source_has_ref check (
    range_source not in ('guideline', 'cmo_signed_config') or coalesce(length(btrim(range_source_ref)), 0) > 0
  ),
  add constraint lab_analyte_readings_lab_source_has_range check (
    range_source <> 'lab_report'
    or (reference_range_low is not null or reference_range_high is not null or reference_range_text is not null)
  );

comment on column public.lab_analyte_readings.range_source is
  'S05b: where the reference range came from. lab_report only when the lab supplied it; guideline and cmo_signed_config need range_source_ref; unspecified is the only value allowed when no range is stored, and screens print "Range not specified".';

-- 2. lab_result_items: stamped on insert from the panel version's sign-off state (the items table is append only, so it is stamped once).
alter table public.lab_result_items
  add column range_source text not null default 'unspecified'
    check (range_source in ('lab_report', 'guideline', 'cmo_signed_config', 'unspecified')),
  add column range_source_ref text;

create function private.stamp_lab_result_item_range_source() returns trigger
language plpgsql security definer set search_path = '' as
$$
declare
  v_panel text;
  v_version integer;
  v_signed boolean;
begin
  if new.ref_low is null and new.ref_high is null then
    new.range_source := 'unspecified';
    new.range_source_ref := null;
    return new;
  end if;
  select v.panel_code, v.version into v_panel, v_version
    from public.lab_results r join public.lab_panel_versions v on v.id = r.panel_version_id
   where r.id = new.lab_result_id;
  -- exactly the predicate the release rules use (private.lab_panels_signed: an active sign-off with a signer), so the label never says less
  -- than the release gate already assumes. Sign-offs have no structured list of the panel versions they cover (follow-up).
  v_signed := private.lab_panels_signed();
  if v_panel is not null and v_signed then
    new.range_source := 'cmo_signed_config';
    new.range_source_ref := 'lab panel ' || replace(v_panel, '_', ' ') || ' version ' || v_version;
  else
    -- a range with no signed configuration behind it is not presented as clinical; the reference records that it was a proposed panel range
    -- (the clinician review screen may show it with that label, nobody else does)
    new.range_source := 'unspecified';
    new.range_source_ref := case when v_panel is not null
      then 'proposed lab panel ' || replace(v_panel, '_', ' ') || ' version ' || v_version || ', not yet signed by the Chief Medical Officer' end;
  end if;
  return new;
end;
$$;
revoke all on function private.stamp_lab_result_item_range_source() from public, anon, authenticated;

create trigger a_lab_result_items_stamp_range_source before insert on public.lab_result_items
  for each row execute function private.stamp_lab_result_item_range_source();

-- 2b. The label is resolved at READ time for the two lab-result read paths. The stored value is the one at insert (the items table is append
--     only); a result entered before the CMO signed is stored with a 'proposed lab panel ...' reference, and as soon as the panels are signed
--     the read path reports it as signed, so it does not stay "Range not specified" for the patient. Before signing, the reading clinician
--     gets the typed marker 'proposed_unsigned' (never a stored value, only an output of this function) instead of a parsed sentence.
create function private.eff_range_source(p_source text, p_ref text, p_low numeric, p_high numeric) returns text
language sql stable security definer set search_path = '' as
$$
  select case
    when p_source = 'unspecified' and (p_low is not null or p_high is not null) and p_ref like 'proposed lab panel %'
      then case when private.lab_panels_signed() then 'cmo_signed_config' else 'proposed_unsigned' end
    else p_source
  end;
$$;
create function private.eff_range_ref(p_source text, p_ref text, p_low numeric, p_high numeric) returns text
language sql stable security definer set search_path = '' as
$$
  select case
    when p_source = 'unspecified' and (p_low is not null or p_high is not null) and p_ref like 'proposed lab panel %' and private.lab_panels_signed()
      then regexp_replace(p_ref, '^proposed (lab panel .* version [0-9]+).*$', '\1')
    else p_ref
  end;
$$;
revoke all on function private.eff_range_source(text, text, numeric, numeric) from public, anon, authenticated;
revoke all on function private.eff_range_ref(text, text, numeric, numeric) from public, anon, authenticated;

-- 3. The three read paths that carry a range now also carry its source. Patched in place from the live definition (so a parallel change to
--    these functions is not overwritten) and each patch is asserted to have applied.
do $$
declare
  v_def text;
  v_out text;
  r record;
begin
  for r in
    select * from (values
      ('public.my_lab_results()'::text,
       '''ref_low'', i.ref_low, ''ref_high'', i.ref_high,',
       '''ref_low'', i.ref_low, ''ref_high'', i.ref_high, ''range_source'', private.eff_range_source(i.range_source, i.range_source_ref, i.ref_low, i.ref_high), ''range_source_ref'', private.eff_range_ref(i.range_source, i.range_source_ref, i.ref_low, i.ref_high),'),
      ('public.lab_result_for_review(uuid,text)',
       '''ref_low'', i.ref_low, ''ref_high'', i.ref_high,',
       '''ref_low'', i.ref_low, ''ref_high'', i.ref_high, ''range_source'', private.eff_range_source(i.range_source, i.range_source_ref, i.ref_low, i.ref_high), ''range_source_ref'', private.eff_range_ref(i.range_source, i.range_source_ref, i.ref_low, i.ref_high),')
    ) as x(fn, old_text, new_text)
  loop
    v_def := pg_get_functiondef(r.fn::regprocedure);
    if position(r.old_text in v_def) = 0 then
      raise exception '%: expected text not found, refusing to guess', r.fn;
    end if;
    v_out := replace(v_def, r.old_text, r.new_text);
    execute v_out;
  end loop;
end $$;

-- 3b. record_share_by_token: patched by name, because its signature changed in S09x (text -> text, text, text). Every overload present is patched.
do $$
declare
  v_oid oid;
  v_def text;
  v_old constant text := '''reference_range_text'', lr.reference_range_text,';
  v_new constant text := '''reference_range_text'', lr.reference_range_text, ''range_source'', lr.range_source, ''range_source_ref'', lr.range_source_ref,';
  v_n integer := 0;
begin
  for v_oid in select p.oid from pg_proc p where p.proname = 'record_share_by_token' and p.pronamespace = 'public'::regnamespace loop
    v_def := pg_get_functiondef(v_oid);
    if position(v_old in v_def) = 0 then
      raise exception 'record_share_by_token (%): expected text not found, refusing to guess', v_oid::regprocedure;
    end if;
    execute replace(v_def, v_old, v_new);
    v_n := v_n + 1;
  end loop;
  if v_n = 0 then raise exception 'record_share_by_token not found'; end if;
end $$;

-- 4. Self-check
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'lab_result_items' and column_name = 'range_source') then
    raise exception 'lab_result_items.range_source missing';
  end if;
  if position('range_source' in pg_get_functiondef('public.my_lab_results()'::regprocedure)) = 0
     or position('range_source' in pg_get_functiondef('public.lab_result_for_review(uuid,text)'::regprocedure)) = 0
     or exists (select 1 from pg_proc p where p.proname = 'record_share_by_token' and p.pronamespace = 'public'::regnamespace
                 and position('range_source' in pg_get_functiondef(p.oid)) = 0) then
    raise exception 'a read path was not patched';
  end if;
  if not exists (select 1 from pg_proc p where p.proname = 'record_share_by_token' and p.pronamespace = 'public'::regnamespace
                  and has_function_privilege('anon', p.oid, 'EXECUTE')) then
    raise exception 'record_share_by_token must stay anon-executable (public share link)';
  end if;
  if has_function_privilege('anon', 'public.my_lab_results()', 'EXECUTE') then
    raise exception 'anon can execute my_lab_results';
  end if;
end $$;
