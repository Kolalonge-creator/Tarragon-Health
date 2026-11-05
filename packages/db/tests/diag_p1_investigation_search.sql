-- Diagnostic directory Phase 1: investigation catalogue + public.search_investigations.
-- Migration: 20261104225509_diag_p1_investigation_catalogue_and_search.sql. Design: docs/plans/diagnostic-directory-design-2026-11-04.md.
--
-- Proves, as a signed-in user (role authenticated):
--   1-6  the founder spec's search cases: mammogram, mammography, abdo USS, abdominal ultrasound, HbA1c, kidney function
--   7    a misspelling with no seeded synonym still finds mammography by similarity
--   8-11 ambiguous terms ask instead of guessing: breast scan, pelvic scan, heart scan, mri
--   12   a loose word ("scan") lists matches and does not pick an ambiguous parent
--   13   an unrelated term returns nothing; a bad threshold is refused
--   14   anon cannot execute the search
--   15   screen_types cannot link to an ambiguous parent (trigger)
--   16   an imaging study cannot link to a lab test or a different modality; the matching concept is accepted
-- Sabotage x2: (a) breast parent no longer ambiguous -> "breast scan" no longer clarifies; (b) trigger dropped ->
-- the ambiguous link is accepted. Each must flip the result, proving the checks discriminate.

begin;

do $$
declare
  t numeric := 0.35;   -- mirrors proposed-config "directory.investigation_search" v1
  r record;
  n int;
  v_ok boolean;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid()::text, 'role', 'authenticated')::text, true);

  select * into r from public.search_investigations('mammogram', t) limit 1;
  if r.code is distinct from 'inv.mammography' then raise exception 'FAIL 1: mammogram -> %', r.code; end if;
  select * into r from public.search_investigations('Mammography', t) limit 1;
  if r.code is distinct from 'inv.mammography' or r.matched_on <> 'display' then raise exception 'FAIL 2: mammography -> % %', r.code, r.matched_on; end if;
  select * into r from public.search_investigations('abdo USS', t) limit 1;
  if r.code is distinct from 'inv.us_abdomen' then raise exception 'FAIL 3: abdo USS -> %', r.code; end if;
  select * into r from public.search_investigations('abdominal ultrasound', t) limit 1;
  if r.code is distinct from 'inv.us_abdomen' then raise exception 'FAIL 4: abdominal ultrasound -> %', r.code; end if;
  select * into r from public.search_investigations('HbA1c', t) limit 1;
  if r.code is distinct from 'inv.hba1c' then raise exception 'FAIL 5: HbA1c -> %', r.code; end if;
  select * into r from public.search_investigations('kidney function', t) limit 1;
  if r.code is distinct from 'inv.kft' then raise exception 'FAIL 6: kidney function -> %', r.code; end if;
  raise notice 'PASS 1-6: standard, abbreviation and lay terms resolve to the right investigation';

  select * into r from public.search_investigations('mammogrm', t) limit 1;
  if r.code is distinct from 'inv.mammography' or r.matched_on <> 'fuzzy' then raise exception 'FAIL 7: mammogrm -> % %', r.code, r.matched_on; end if;
  raise notice 'PASS 7: misspelling found by similarity';

  select count(*), bool_and(matched_on = 'clarify') into n, v_ok from public.search_investigations('breast scan', t);
  if n <> 3 or not v_ok then raise exception 'FAIL 8: breast scan should offer 3 choices, got % (clarify=%)', n, v_ok; end if;
  select * into r from public.search_investigations('breast scan', t) limit 1;
  if r.code is distinct from 'inv.mammography' then raise exception 'FAIL 8b: first breast choice should be mammography, got %', r.code; end if;
  if not exists (select 1 from public.search_investigations('breast scan', t) where code = 'inv.us_breast') then
    raise exception 'FAIL 8c: breast ultrasound missing from the breast choices';
  end if;
  select count(*) into n from public.search_investigations('pelvic scan', t) where matched_on = 'clarify';
  if n <> 3 then raise exception 'FAIL 9: pelvic scan should offer 3 choices, got %', n; end if;
  select count(*) into n from public.search_investigations('heart scan', t) where matched_on = 'clarify';
  if n <> 3 then raise exception 'FAIL 10: heart scan should offer 3 choices, got %', n; end if;
  if not exists (select 1 from public.search_investigations('MRI', t) where matched_on = 'clarify' and code = 'inv.mri_brain') then
    raise exception 'FAIL 11: MRI should ask which body part';
  end if;
  select matched_on into r from public.search_investigations('MRI', t) where code = 'inv.mri_spine';
  if r.matched_on is distinct from 'clarify_group' then raise exception 'FAIL 11b: MRI spine must be a group, got %', r.matched_on; end if;
  raise notice 'PASS 8-11: ambiguous terms ask, never guess';

  select * into r from public.search_investigations('chest ct', t) where code = 'inv.ct_chest';
  if r.matched_on is distinct from 'fuzzy' or r.score > 0.89 then
    raise exception 'FAIL 11c: reordered words must stay a capped fuzzy match, got % %', r.matched_on, r.score;
  end if;
  raise notice 'PASS 11c: fuzzy never poses as exact';

  if exists (select 1 from public.search_investigations('scan', t) where matched_on = 'clarify') then
    raise exception 'FAIL 12: a loose word must not pick an ambiguous parent';
  end if;
  if not exists (select 1 from public.search_investigations('scan', t)) then
    raise exception 'FAIL 12b: "scan" should still list matches';
  end if;
  raise notice 'PASS 12: loose word lists matches';

  if exists (select 1 from public.search_investigations('purple elephant umbrella', t)) then
    raise exception 'FAIL 13: unrelated term returned rows';
  end if;
  begin
    perform public.search_investigations('fbc', 0.05);
    raise exception 'FAIL 13b: a threshold below 0.1 was accepted';
  exception when sqlstate '22023' then null;
  end;
  raise notice 'PASS 13: unrelated term empty, bad threshold refused';

  perform set_config('role', 'postgres', true);
  if has_function_privilege('anon', 'public.search_investigations(text, numeric, integer)', 'EXECUTE') then
    raise exception 'FAIL 14: anon can execute search_investigations';
  end if;
  raise notice 'PASS 14: anon cannot search';

  v_ok := false;
  begin
    update public.screen_types set concept_id = (select id from public.reference_concepts where code = 'inv.breast_imaging')
     where code = 'breast_imaging';
  exception when sqlstate '23514' then v_ok := true;
  end;
  if not v_ok then raise exception 'FAIL 15: screen_types accepted an ambiguous concept'; end if;
  raise notice 'PASS 15: ambiguous concept cannot be linked';

  -- 16: an imaging study cannot link to a lab test or to another modality; the right one is accepted
  insert into public.imaging_providers (id, name) values ('00000000-0000-4000-8000-00000000d1a6', 'Proof imaging centre');
  insert into public.imaging_studies (provider_id, modality, code, name, price_kobo)
  values ('00000000-0000-4000-8000-00000000d1a6', 'xray', 'proof_cxr', 'Proof chest X-ray', 0);
  v_ok := false;
  begin
    update public.imaging_studies set concept_id = (select id from public.reference_concepts where code = 'inv.hba1c') where code = 'proof_cxr';
  exception when sqlstate '23514' then v_ok := true;
  end;
  if not v_ok then raise exception 'FAIL 16: imaging study accepted a lab test concept'; end if;
  v_ok := false;
  begin
    update public.imaging_studies set concept_id = (select id from public.reference_concepts where code = 'inv.ct_chest') where code = 'proof_cxr';
  exception when sqlstate '23514' then v_ok := true;
  end;
  if not v_ok then raise exception 'FAIL 16b: an X-ray study accepted a CT concept'; end if;
  update public.imaging_studies set concept_id = (select id from public.reference_concepts where code = 'inv.xray_chest') where code = 'proof_cxr';
  raise notice 'PASS 16: imaging links must match domain and modality';

  -- Sabotage (a)
  update public.reference_concepts set is_ambiguous = false where code = 'inv.breast_imaging';
  perform set_config('role', 'authenticated', true);
  if exists (select 1 from public.search_investigations('breast scan', t) where matched_on = 'clarify') then
    raise exception 'SABOTAGE a did not flip: breast scan still clarifies with the flag removed';
  end if;
  perform set_config('role', 'postgres', true);
  update public.reference_concepts set is_ambiguous = true where code = 'inv.breast_imaging';

  -- Sabotage (b)
  drop trigger screen_types_require_investigation_concept on public.screen_types;
  update public.screen_types set concept_id = (select id from public.reference_concepts where code = 'inv.breast_imaging')
   where code = 'breast_imaging';
  if not exists (select 1 from public.screen_types st join public.reference_concepts c on c.id = st.concept_id
                  where st.code = 'breast_imaging' and c.code = 'inv.breast_imaging') then
    raise exception 'SABOTAGE b did not flip: link still refused with the trigger dropped';
  end if;
  raise notice 'PASS sabotage: both checks discriminate';
end;
$$;

rollback;
