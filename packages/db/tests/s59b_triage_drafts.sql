-- Proof (S59b): the two UNSIGNED, INACTIVE triage_protocols drafts.
--   A. 'S59b draft: chest pain...' is the base protocol with EXACTLY one change: chest_pain.cardiac_pattern has no minSeverity.
--   B. 'S59 draft:...' is ONE merged draft: base (same chest pain change) + the adult v2 pathways + three paediatric pathways.
--   Neither is active or signed; the active row (if any) is untouched; the config version equals the row version.
-- Sabotage: a second, unrelated change slipped into draft A must be detected by the same check.
begin;

create function pg_temp.diff_keys(a jsonb, b jsonb) returns text[] language sql as $f$
  -- keys of every red flag or node that differs between two pathway lists (by pathway key), a rough but total comparison
  select coalesce(array_agg(distinct d), '{}') from (
    select pa ->> 'key' || ':' || coalesce(fa ->> 'key', 'node') as d
      from jsonb_array_elements(a) pa
      join jsonb_array_elements(b) pb on pb ->> 'key' = pa ->> 'key'
      left join lateral jsonb_array_elements(pa -> 'redFlagScreen') fa on true
      left join lateral jsonb_array_elements(pb -> 'redFlagScreen') fb on fb ->> 'key' = fa ->> 'key'
     where fa is not null and fa is distinct from fb
    union all
    select pa ->> 'key' || ':nodes' from jsonb_array_elements(a) pa join jsonb_array_elements(b) pb on pb ->> 'key' = pa ->> 'key' where pa -> 'nodes' is distinct from pb -> 'nodes'
    union all
    select pa ->> 'key' || ':fallback' from jsonb_array_elements(a) pa join jsonb_array_elements(b) pb on pb ->> 'key' = pa ->> 'key' where pa -> 'fallbackOutcome' is distinct from pb -> 'fallbackOutcome'
  ) x
$f$;

do $$
declare
  v_base jsonb; v_a public.triage_protocols%rowtype; v_b public.triage_protocols%rowtype; v_keys text[]; v_cfg jsonb; v_n integer;
begin
  select coalesce((select config from public.triage_protocols where is_active limit 1), (select config from public.triage_protocols where version = 1)) into v_base;
  select * into v_a from public.triage_protocols where notes like 'S59b draft: chest pain%';
  select * into v_b from public.triage_protocols where notes like 'S59 draft:%';
  if v_a.version is null then raise exception 'FAIL A0: the chest pain draft is missing'; end if;
  if v_b.version is null then raise exception 'FAIL B0: the merged draft is missing'; end if;
  if v_a.is_active or v_a.approved_at is not null or v_a.approved_by is not null then raise exception 'FAIL A1: draft A is active or signed'; end if;
  if v_b.is_active or v_b.approved_at is not null or v_b.approved_by is not null then raise exception 'FAIL B1: draft B is active or signed'; end if;
  if (v_a.config ->> 'version')::integer <> v_a.version or (v_b.config ->> 'version')::integer <> v_b.version then raise exception 'FAIL A2: config version <> row version'; end if;
  v_keys := pg_temp.diff_keys(v_base -> 'pathways', v_a.config -> 'pathways');
  if v_keys <> array['chest_pain:chest_pain.cardiac_pattern'] then raise exception 'FAIL A3: draft A differs from the base in more than the cardiac pattern: %', v_keys; end if;
  if (select count(*) from jsonb_array_elements(v_a.config -> 'pathways')) <> (select count(*) from jsonb_array_elements(v_base -> 'pathways')) then raise exception 'FAIL A4: draft A added or dropped a pathway'; end if;
  -- B: carries the adult pathways (with the same single change), the v2 extras and the paediatric ones
  v_keys := pg_temp.diff_keys(v_base -> 'pathways', v_b.config -> 'pathways');
  if v_keys <> array['chest_pain:chest_pain.cardiac_pattern'] then raise exception 'FAIL B2: the merged draft changes the base pathways beyond the cardiac pattern: %', v_keys; end if;
  select count(*) into v_n from jsonb_array_elements(v_b.config -> 'pathways') p where p ->> 'key' like 'paediatric\_%';
  if v_n <> 3 then raise exception 'FAIL B3: expected 3 paediatric pathways, found %', v_n; end if;
  if not exists (select 1 from jsonb_array_elements(v_b.config -> 'pathways') p where p ->> 'key' in ('fever', 'abdominal_pain')) and exists (select 1 from public.triage_protocols where version = 2) then
    raise exception 'FAIL B4: the adult v2 pathways were not merged into the draft';
  end if;
  if (select count(*) from (select p ->> 'key' k from jsonb_array_elements(v_b.config -> 'pathways') p group by 1 having count(*) > 1) d) > 0 then raise exception 'FAIL B5: a pathway key appears twice in the merged draft'; end if;
  if (select count(*) from public.triage_protocols where is_active) > 1 then raise exception 'FAIL X1: more than one active protocol'; end if;

  -- SABOTAGE: slip a second change into draft A's config (in memory); the same check must now name it
  v_cfg := jsonb_set(v_a.config, '{pathways,0,redFlagScreen,0,category}', '"urgent"');
  v_keys := pg_temp.diff_keys(v_base -> 'pathways', v_cfg -> 'pathways');
  if v_keys = array['chest_pain:chest_pain.cardiac_pattern'] then raise exception 'VACUOUS TEST: a second change was not detected'; end if;
end $$;

select 'PASS: S59b drafts are unsigned, inactive and exactly what they say' as result;
rollback;
