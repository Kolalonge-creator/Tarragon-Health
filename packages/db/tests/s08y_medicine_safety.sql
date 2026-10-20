-- S08y proof: duplicate-ingredient twin, governed interaction rules, brand-to-generic map, NAFDAC number note, supporter's
-- "today's doses". Everything is born OFF and UNSIGNED; this proof signs only inside a rolled-back transaction, on throwaway users.
--
-- Proves in one rolled-back transaction:
--   1. SQL twin: private.duplicate_ingredient_pairs gives the answers packages/medicines `findDuplicateIngredients` gives for the shared
--      cases in ingredients.fixtures.ts (a Jest test fails if a case name here goes missing), and the rule-set shape check
--      private.interaction_rules_valid gives the answers `validateRuleSet` gives for interaction-rules.fixtures.ts.
--   2. Rule sets: v1 ships EMPTY, unsigned, inactive; no rule is seeded; a patient cannot insert or sign; a senior doctor cannot sign;
--      the CMO cannot sign an empty set, can sign a non-empty one; an older version cannot be re-activated after a newer is signed;
--      a patient reads only the signed set, never a draft; the rules reach a client only while the guard is open (and never when
--      the guard is closed); the guard is born off.
--   3. Brand map: born empty; only staff/admin enter rows (draft, citation must be an https link); a draft is invisible to a patient;
--      the person who entered a row cannot review it; a second clinician can; a reviewed row is visible; editing it withdraws the
--      review; an admin, a pharmacist account and a patient cannot review; nothing writes directly to the table.
--   4. NAFDAC note: the person (not another patient) can store a well-formed number; free text is refused; blank clears; no direct
--      write; the note follows an amended medicine; the prescribed row is untouched.
--   5. Supporter's doses: a supporter holding the `medications` category reads today's slots; a supporter with clinical_access and
--      view_medication but NO category, a stranger, the person herself and another patient's supporter are all refused
--      ('not_shared'); a non-test supporter sees nothing while the guard is closed; every read is audited; anon cannot execute.
--   6. SABOTAGE: with the category check removed from supporter_todays_doses and the twin made blind, the matching checks must flip.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;

create or replace function pg_temp.attempt(p_sql text) returns text language plpgsql as $f$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return sqlstate;
end $f$;

create or replace function pg_temp.as_user(p_uid uuid) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $f$;

create or replace function pg_temp.pairs_of(p_items jsonb) returns text language sql as $f$
  select coalesce(string_agg(a || '|' || b || '|' || array_to_string(shared, ','), ';' order by a collate "C", b collate "C"), '')
    from private.duplicate_ingredient_pairs(p_items)
$f$;

create or replace function pg_temp.run_checks(p_phase text) returns void
language plpgsql as $f$
declare
  v_org uuid;
  v_pat uuid := gen_random_uuid();        -- the person whose medicines are shared (is_test: guards open for her)
  v_other uuid := gen_random_uuid();      -- another patient
  v_smo uuid := gen_random_uuid();        -- clinician 1 (enters brand rows)
  v_smo2 uuid := gen_random_uuid();       -- clinician 2 (reviews them)
  v_cmo uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_pharm uuid := gen_random_uuid();
  v_sup uuid := gen_random_uuid();        -- supporter WITH the medicines category (is_test)
  v_sup_real uuid := gen_random_uuid();   -- supporter WITH the category, ordinary account (guard closed for her)
  v_sup_nocat uuid := gen_random_uuid();  -- supporter with clinical_access + view_medication but NO category
  v_sup_other uuid := gen_random_uuid();  -- a supporter of someone else
  v_stranger uuid := gen_random_uuid();
  v_pa uuid; v_med uuid; v_med2 uuid; v_amend uuid; v_row uuid; v_row2 uuid; v_set1 uuid; v_set2 uuid; v_set3 uuid;
  v_n integer;
  v_res jsonb := '[]'::jsonb;
  v_case record;
  v_today date := (now() at time zone 'Africa/Lagos')::date;
  v_doc jsonb;
  v_audits_before integer;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  if v_org is null then raise exception 'S08y proof needs one organisation (seed fixture missing)'; end if;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  select u, 's08y-' || substr(u::text, 1, 8) || '@example.invalid', 'x', now(), '{}', '{}'
    from unnest(array[v_pat, v_other, v_smo, v_smo2, v_cmo, v_admin, v_pharm, v_sup, v_sup_real, v_sup_nocat, v_sup_other, v_stranger]) u;
  insert into public.profiles (id, organisation_id, role, full_name, is_test) values
    (v_pat,        v_org, 'patient',    'S08y Patient', true),
    (v_other,      v_org, 'patient',    'S08y Other Patient', true),
    (v_smo,        v_org, 'clinician',  'S08y Clinician One', false),
    (v_smo2,       v_org, 'clinician',  'S08y Clinician Two', false),
    (v_cmo,        v_org, 'clinician',  'S08y CMO', false),
    (v_admin,      v_org, 'admin',      'S08y Admin', false),
    (v_pharm,      v_org, 'pharmacist', 'S08y Pharmacist', false),
    (v_sup,        v_org, 'patient',    'S08y Supporter', true),
    (v_sup_real,   v_org, 'patient',    'S08y Supporter Real', false),
    (v_sup_nocat,  v_org, 'patient',    'S08y Supporter No Category', true),
    (v_sup_other,  v_org, 'patient',    'S08y Supporter Of Other', true),
    (v_stranger,   v_org, 'patient',    'S08y Stranger', true)
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, is_test = excluded.is_test, full_name = excluded.full_name;
  insert into public.clinical_staff (organisation_id, profile_id, full_name, active, license_verified_at, doctor_tier,
                                     indemnity_insurer, indemnity_policy_number, indemnity_expires_at) values
    (v_org, v_smo,  'S08y Clinician One', true, now(), 'senior_medical_officer', 'Probe Indemnity', 'S08Y-1', now() + interval '1 year'),
    (v_org, v_smo2, 'S08y Clinician Two', true, now(), 'senior_medical_officer', 'Probe Indemnity', 'S08Y-2', now() + interval '1 year'),
    (v_org, v_cmo,  'S08y CMO',           true, now(), 'chief_medical_officer',  'Probe Indemnity', 'S08Y-3', now() + interval '1 year');

  -- 1. SQL twin: the shared cases -------------------------------------------------------------------------------------------
  for v_case in select * from (values
    ('no medicines', '[]', ''),
    ('one medicine alone', '[{"id":"a","generic":"Paracetamol"}]', ''),
    ('same generic twice', '[{"id":"a","generic":"Paracetamol"},{"id":"b","generic":"paracetamol"}]', 'a|b|paracetamol'),
    ('different medicines', '[{"id":"a","generic":"Paracetamol"},{"id":"b","generic":"Ibuprofen"}]', ''),
    ('combination shares one ingredient', '[{"id":"a","generic":"Amoxicillin"},{"id":"b","generic":"Amoxicillin and clavulanic acid"}]', 'a|b|amoxicillin'),
    ('two combinations share both', '[{"id":"a","generic":"Amoxicillin and clavulanic acid"},{"id":"b","generic":"Clavulanic acid / Amoxicillin"}]', 'a|b|amoxicillin,clavulanic acid'),
    ('order of the list does not matter', '[{"id":"z","generic":"Paracetamol + caffeine"},{"id":"m","generic":"Caffeine"},{"id":"a","generic":"Paracetamol"}]', 'a|z|paracetamol;m|z|caffeine'),
    ('punctuation and case are ignored', '[{"id":"a","generic":"PARA-CETAMOL"},{"id":"b","generic":"para cetamol"}]', 'a|b|para cetamol'),
    ('a salt name is not matched', '[{"id":"a","generic":"Amlodipine besylate"},{"id":"b","generic":"Amlodipine"}]', ''),
    ('the same id twice is not a pair', '[{"id":"a","generic":"Paracetamol"},{"id":"a","generic":"Paracetamol"}]', ''),
    ('a strength and a dose form typed after the name are ignored', '[{"id":"a","generic":"Lisinopril 10mg tablets"},{"id":"b","generic":"lisinopril"},{"id":"c","generic":"Lisinopril 0.5 g"}]', 'a|b|lisinopril;a|c|lisinopril;b|c|lisinopril'),
    ('a strength alone is not an ingredient', '[{"id":"a","generic":"Paracetamol 500 mg/5 ml"},{"id":"b","generic":"Ibuprofen 500 mg/5 ml"}]', ''),
    ('blank names match nothing', '[{"id":"a","generic":"  "},{"id":"b","generic":""}]', '')
  ) as c(name, items, want)
  loop
    v_res := v_res || jsonb_build_array(jsonb_build_array('twin: ' || v_case.name || ' [''' || v_case.name || ''']', v_case.want, pg_temp.pairs_of(v_case.items::jsonb)));
  end loop;

  for v_case in select * from (values
    ('an empty set is valid (how the table is born)', '{"rules": []}', 'true'),
    ('one well-formed rule', '{"rules":[{"code":"example_rule","ingredientA":"exampleone","ingredientB":"exampletwo","severity":"caution","source":"https://example.org/source"}]}', 'true'),
    ('rules is not a list', '{"rules":"none"}', 'false'),
    ('no rules key', '{}', 'false'),
    ('a rule without a source', '{"rules":[{"code":"example_rule","ingredientA":"exampleone","ingredientB":"exampletwo","severity":"caution","source":""}]}', 'false'),
    ('an unknown severity', '{"rules":[{"code":"example_rule","ingredientA":"exampleone","ingredientB":"exampletwo","severity":"severe","source":"https://example.org/source"}]}', 'false'),
    ('an ingredient that is not normalised', '{"rules":[{"code":"example_rule","ingredientA":"Example One","ingredientB":"exampletwo","severity":"caution","source":"https://example.org/source"}]}', 'false'),
    ('the same ingredient on both sides', '{"rules":[{"code":"example_rule","ingredientA":"exampleone","ingredientB":"exampleone","severity":"caution","source":"https://example.org/source"}]}', 'false'),
    ('a repeated rule code', '{"rules":[{"code":"example_rule","ingredientA":"exampleone","ingredientB":"exampletwo","severity":"caution","source":"https://example.org/source"},{"code":"example_rule","ingredientA":"exampleone","ingredientB":"examplethree","severity":"caution","source":"https://example.org/source"}]}', 'false'),
    ('a bad rule code', '{"rules":[{"code":"Bad Code","ingredientA":"exampleone","ingredientB":"exampletwo","severity":"caution","source":"https://example.org/source"}]}', 'false')
  ) as c(name, config, want)
  loop
    v_res := v_res || jsonb_build_array(jsonb_build_array('rule shape: ' || v_case.name || ' [''' || v_case.name || ''']', v_case.want, private.interaction_rules_valid(v_case.config::jsonb)::text));
  end loop;

  -- 2. Governed rule sets ------------------------------------------------------------------------------------------------------
  select id into v_set1 from public.medicine_interaction_rule_sets where version = 1;
  v_res := v_res || jsonb_build_array(jsonb_build_array('v1 ships empty, unsigned and inactive', 'true',
    (select (jsonb_array_length(config -> 'rules') = 0 and not is_active and approved_by is null and approved_at is null)::text from public.medicine_interaction_rule_sets where id = v_set1)));
  v_res := v_res || jsonb_build_array(jsonb_build_array('no rule set is live and no rule exists before signing', '0:0',
    (select count(*) from public.medicine_interaction_rule_sets where is_active)::text || ':' ||
    (select coalesce(sum(jsonb_array_length(config -> 'rules')), 0) from public.medicine_interaction_rule_sets)::text));
  v_res := v_res || jsonb_build_array(jsonb_build_array('the guards are born off', '3',
    (select count(*)::text from public.go_live_guards where key in ('medicine_duplicate_ingredient_check', 'medicine_interaction_rules', 'supporter_todays_doses') and not is_on)));

  perform pg_temp.as_user(v_pat);
  v_res := v_res || jsonb_build_array(jsonb_build_array('a patient cannot insert a rule set', '42501',
    pg_temp.attempt($$insert into public.medicine_interaction_rule_sets (version, config) values (90, '{"rules": []}')$$)));
  v_res := v_res || jsonb_build_array(jsonb_build_array('a patient cannot sign a rule set', '42501',
    pg_temp.attempt(format('select public.sign_medicine_interaction_rule_sets(%L)', v_set1))));
  v_res := v_res || jsonb_build_array(jsonb_build_array('a patient cannot read a draft rule set', '0',
    (select count(*)::text from public.medicine_interaction_rule_sets)));
  execute 'reset role';

  perform pg_temp.as_user(v_cmo);
  v_res := v_res || jsonb_build_array(jsonb_build_array('a malformed rule set cannot be inserted', '23514',
    pg_temp.attempt($$insert into public.medicine_interaction_rule_sets (version, config) values (91, '{"rules":[{"code":"x"}]}')$$)));
  v_res := v_res || jsonb_build_array(jsonb_build_array('a draft cannot be inserted already active', '42501',
    pg_temp.attempt($$insert into public.medicine_interaction_rule_sets (version, config, is_active) values (92, '{"rules": []}', true)$$)));
  insert into public.medicine_interaction_rule_sets (version, config, notes) values
    (2, '{"rules":[{"code":"example_rule","ingredientA":"exampleone","ingredientB":"exampletwo","severity":"caution","source":"https://example.org/source"}]}', 'proof: synthetic, fictional ingredients');
  execute 'reset role';
  select id into v_set2 from public.medicine_interaction_rule_sets where version = 2;

  perform pg_temp.as_user(v_smo);
  v_res := v_res || jsonb_build_array(jsonb_build_array('a senior doctor cannot sign', '42501',
    pg_temp.attempt(format('select public.sign_medicine_interaction_rule_sets(%L)', v_set2))));
  execute 'reset role';
  perform pg_temp.as_user(v_cmo);
  v_res := v_res || jsonb_build_array(jsonb_build_array('the CMO cannot sign an empty set', '22023',
    pg_temp.attempt(format('select public.sign_medicine_interaction_rule_sets(%L)', v_set1))));
  execute 'reset role';

  -- Before any signature, even a test account's guard-open call returns nothing: no signed set exists.
  perform pg_temp.as_user(v_pat);
  v_res := v_res || jsonb_build_array(jsonb_build_array('before signing the rules call answers closed', 'closed',
    public.active_medicine_interaction_rules() ->> 'status'));
  execute 'reset role';

  perform pg_temp.as_user(v_cmo);
  v_res := v_res || jsonb_build_array(jsonb_build_array('the active CMO signs a non-empty set (inside this rolled-back proof only)', 'ok',
    pg_temp.attempt(format('select public.sign_medicine_interaction_rule_sets(%L)', v_set2))));
  execute 'reset role';
  v_res := v_res || jsonb_build_array(jsonb_build_array('the signed set is live and attributed', 'true',
    (select (is_active and approved_by is not null and approved_at is not null)::text from public.medicine_interaction_rule_sets where id = v_set2)));

  perform pg_temp.as_user(v_cmo);
  insert into public.medicine_interaction_rule_sets (version, config, notes) values (3, '{"rules": []}', 'proof: newer draft');
  execute 'reset role';
  select id into v_set3 from public.medicine_interaction_rule_sets where version = 3;
  -- a signed version older than a newer signed one cannot come back
  update public.medicine_interaction_rule_sets set approved_by = (select id from public.clinical_staff where profile_id = v_cmo), approved_at = now() where id = v_set3;
  update public.medicine_interaction_rule_sets set is_active = false where id = v_set2;
  v_res := v_res || jsonb_build_array(jsonb_build_array('an older signed version cannot be re-activated', '23514',
    pg_temp.attempt(format('update public.medicine_interaction_rule_sets set is_active = true where id = %L', v_set2))));
  update public.medicine_interaction_rule_sets set approved_by = null, approved_at = null where id = v_set3;
  update public.medicine_interaction_rule_sets set is_active = true where id = v_set2;

  perform pg_temp.as_user(v_pat);
  v_res := v_res || jsonb_build_array(jsonb_build_array('a patient reads only the signed set, not the draft', '1',
    (select count(*)::text from public.medicine_interaction_rule_sets)));
  v_doc := public.active_medicine_interaction_rules();
  v_res := v_res || jsonb_build_array(jsonb_build_array('guard open (test account) and a signed set: the rules arrive', 'ok:1',
    (v_doc ->> 'status') || ':' || jsonb_array_length(v_doc -> 'rules')::text));
  execute 'reset role';
  perform pg_temp.as_user(v_sup_real);
  v_res := v_res || jsonb_build_array(jsonb_build_array('guard closed (ordinary account): no rules reach the client', 'closed',
    public.active_medicine_interaction_rules() ->> 'status'));
  execute 'reset role';

  -- 3. Brand map ------------------------------------------------------------------------------------------------------------------
  v_res := v_res || jsonb_build_array(jsonb_build_array('the brand map is born empty', '0', (select count(*)::text from public.medicine_brand_generic_map)));
  perform pg_temp.as_user(v_pat);
  v_res := v_res || jsonb_build_array(jsonb_build_array('a patient cannot enter a brand row', '42501',
    pg_temp.attempt($$select public.save_medicine_brand_map(null, 'Examplebrand', array['exampleone'], 'https://example.org/greenbook')$$)));
  v_res := v_res || jsonb_build_array(jsonb_build_array('a patient cannot import brand rows', '42501',
    pg_temp.attempt($$select public.import_medicine_brand_map('[]')$$)));
  v_res := v_res || jsonb_build_array(jsonb_build_array('nobody writes the table directly', '42501',
    pg_temp.attempt($$insert into public.medicine_brand_generic_map (brand_name, ingredients, source_citation) values ('X Brand', array['exampleone'], 'https://example.org/x')$$)));
  execute 'reset role';

  perform pg_temp.as_user(v_smo);
  v_res := v_res || jsonb_build_array(jsonb_build_array('a citation without a link is refused', '23514',
    pg_temp.attempt($$select public.save_medicine_brand_map(null, 'Nolink', array['exampleone'], 'trust me, it is right')$$)));
  v_res := v_res || jsonb_build_array(jsonb_build_array('a clinician imports two draft rows', '2',
    public.import_medicine_brand_map('[{"brand_name":"Examplebrand","ingredients":["exampleone","exampletwo"],"source_citation":"https://example.org/greenbook/1"},{"brand_name":"Otherbrand","ingredients":["examplethree"],"source_citation":"https://example.org/greenbook/2"}]'::jsonb)::text));
  v_res := v_res || jsonb_build_array(jsonb_build_array('importing a brand already on file adds nothing', '0',
    public.import_medicine_brand_map('[{"brand_name":"ExampleBRAND","ingredients":["exampleone"],"source_citation":"https://example.org/greenbook/3"}]'::jsonb)::text));
  execute 'reset role';
  select id into v_row from public.medicine_brand_generic_map where brand_key = 'examplebrand';
  select id into v_row2 from public.medicine_brand_generic_map where brand_key = 'otherbrand';
  v_res := v_res || jsonb_build_array(jsonb_build_array('imported rows are drafts: inactive and unreviewed', 'true',
    (select (bool_and(not is_active) and bool_and(reviewed_by is null))::text from public.medicine_brand_generic_map)));

  perform pg_temp.as_user(v_pat);
  v_res := v_res || jsonb_build_array(jsonb_build_array('a patient sees no draft brand row', '0', (select count(*)::text from public.medicine_brand_generic_map)));
  execute 'reset role';
  perform pg_temp.as_user(v_smo);
  v_res := v_res || jsonb_build_array(jsonb_build_array('the person who entered a row cannot review it', '42501',
    pg_temp.attempt(format('select public.review_medicine_brand_map(%L, true)', v_row))));
  execute 'reset role';
  perform pg_temp.as_user(v_admin);
  v_res := v_res || jsonb_build_array(jsonb_build_array('an admin cannot review', '42501', pg_temp.attempt(format('select public.review_medicine_brand_map(%L, true)', v_row))));
  v_res := v_res || jsonb_build_array(jsonb_build_array('an admin can enter a draft row', 'ok',
    pg_temp.attempt($$select public.save_medicine_brand_map(null, 'Adminbrand', array['examplefour'], 'https://example.org/greenbook/4')$$)));
  execute 'reset role';
  perform pg_temp.as_user(v_pharm);
  v_res := v_res || jsonb_build_array(jsonb_build_array('a pharmacist account cannot review', '42501', pg_temp.attempt(format('select public.review_medicine_brand_map(%L, true)', v_row))));
  v_res := v_res || jsonb_build_array(jsonb_build_array('a pharmacist account cannot enter a row', '42501',
    pg_temp.attempt($$select public.save_medicine_brand_map(null, 'Pharmbrand', array['examplefive'], 'https://example.org/greenbook/5')$$)));
  execute 'reset role';
  perform pg_temp.as_user(v_smo2);
  v_res := v_res || jsonb_build_array(jsonb_build_array('a second clinician reviews it', 'ok', pg_temp.attempt(format('select public.review_medicine_brand_map(%L, true)', v_row))));
  execute 'reset role';
  v_res := v_res || jsonb_build_array(jsonb_build_array('the row is in use with a named reviewer', 'true:S08y Clinician Two',
    (select (is_active and reviewed_at is not null)::text || ':' || reviewer_name from public.medicine_brand_generic_map where id = v_row)));
  perform pg_temp.as_user(v_pat);
  v_res := v_res || jsonb_build_array(jsonb_build_array('a patient sees only the reviewed row', 'examplebrand',
    coalesce((select string_agg(brand_key, ',') from public.medicine_brand_generic_map), '')));
  execute 'reset role';
  perform pg_temp.as_user(v_smo);
  perform public.save_medicine_brand_map(v_row, 'Examplebrand', array['exampleone'], 'https://example.org/greenbook/1-corrected');
  execute 'reset role';
  v_res := v_res || jsonb_build_array(jsonb_build_array('editing a row withdraws its review and takes it out of use', 'false:true',
    (select (is_active)::text || ':' || (reviewed_by is null)::text from public.medicine_brand_generic_map where id = v_row)));
  v_res := v_res || jsonb_build_array(jsonb_build_array('a row cannot be active without a reviewer', '23514',
    pg_temp.attempt(format('update public.medicine_brand_generic_map set is_active = true where id = %L', v_row2))));

  -- 4. The NAFDAC number note ------------------------------------------------------------------------------------------------------
  insert into public.medications (organisation_id, patient_id, drug_name, dose, frequency, schedule_times, source, is_active, created_at)
    values (v_org, v_pat, 'S08y Daily', '10 mg', 'daily', '["00:01","23:59"]', 'clinician', true, now() - interval '2 days') returning id into v_med;
  perform pg_temp.as_user(v_pat);
  v_res := v_res || jsonb_build_array(jsonb_build_array('the person stores a number (canonicalised)', 'ok',
    pg_temp.attempt(format('select public.set_medication_nafdac_number(%L, %L)', v_med, ' a4-1234 '))));
  v_res := v_res || jsonb_build_array(jsonb_build_array('the stored number is upper case', 'A4-1234',
    coalesce((select nafdac_number from public.medication_pack_numbers where medication_id = v_med), 'none')));
  v_res := v_res || jsonb_build_array(jsonb_build_array('free text is refused', '22023',
    pg_temp.attempt(format('select public.set_medication_nafdac_number(%L, %L)', v_med, 'this one is genuine'))));
  v_res := v_res || jsonb_build_array(jsonb_build_array('no direct insert', '42501',
    pg_temp.attempt(format('insert into public.medication_pack_numbers (medication_id, organisation_id, patient_id, nafdac_number) values (%L, %L, %L, %L)', v_med, v_org, v_pat, '04-1234'))));
  execute 'reset role';
  perform pg_temp.as_user(v_other);
  v_res := v_res || jsonb_build_array(jsonb_build_array('another patient cannot store a number for this medicine', '42501',
    pg_temp.attempt(format('select public.set_medication_nafdac_number(%L, %L)', v_med, '04-1234'))));
  v_res := v_res || jsonb_build_array(jsonb_build_array('another patient cannot read the note', '0', (select count(*)::text from public.medication_pack_numbers)));
  execute 'reset role';
  insert into public.medications (organisation_id, patient_id, drug_name, dose, frequency, schedule_times, source, is_active, previous_version_id, version)
    values (v_org, v_pat, 'S08y Daily amended', '10 mg', 'daily', '["08:00"]', 'clinician', false, v_med, 2) returning id into v_amend;
  v_res := v_res || jsonb_build_array(jsonb_build_array('the note follows an amended medicine', 'A4-1234',
    coalesce((select nafdac_number from public.medication_pack_numbers where medication_id = v_amend), 'none')));
  v_res := v_res || jsonb_build_array(jsonb_build_array('the prescribed row itself is untouched', 'S08y Daily:10 mg',
    (select drug_name || ':' || dose from public.medications where id = v_med)));
  perform pg_temp.as_user(v_pat);
  perform public.set_medication_nafdac_number(v_med, '   ');
  execute 'reset role';
  v_res := v_res || jsonb_build_array(jsonb_build_array('a blank clears the note', 'none',
    coalesce((select nafdac_number from public.medication_pack_numbers where medication_id = v_med), 'none')));
  v_res := v_res || jsonb_build_array(jsonb_build_array('the note table is in the data registry', 'true',
    (exists (select 1 from public.data_registry where table_name = 'medication_pack_numbers'))::text));

  -- 5. The supporter's doses --------------------------------------------------------------------------------------------------------------
  -- Only the record's owner may grant a category (private.enforce_category_access_owner): act as her, without changing role.
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  insert into public.profile_access (profile_id, grantee_user_id, granted_by) values (v_pat, v_sup, v_pat) returning id into v_pa;
  insert into public.profile_access_categories (profile_access_id, category) values (v_pa, 'medications');
  insert into public.profile_access (profile_id, grantee_user_id, granted_by) values (v_pat, v_sup_real, v_pat) returning id into v_pa;
  insert into public.profile_access_categories (profile_access_id, category) values (v_pa, 'medications');
  -- wide-looking grants that are NOT the category: clinical_access and the view_medication permission
  insert into public.profile_access (profile_id, grantee_user_id, granted_by, clinical_access, permissions)
    values (v_pat, v_sup_nocat, v_pat, true, array['view_medication']::public.caregiver_permission[]);
  perform set_config('request.jwt.claims', json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
  insert into public.profile_access (profile_id, grantee_user_id, granted_by) values (v_other, v_sup_other, v_other) returning id into v_pa;
  insert into public.profile_access_categories (profile_access_id, category) values (v_pa, 'medications');

  -- 00:01 slot taken today; 23:59 slot has no answer. (00:01 is always in the past in Lagos time, 23:59 is not, except in the final minute.)
  insert into public.medication_logs (organisation_id, patient_id, medication_id, status, scheduled_time, scheduled_for_date, source, client_id, logged_at)
    values (v_org, v_pat, v_med, 'taken', '00:01', v_today, 'patient', gen_random_uuid(), now());

  perform pg_temp.as_user(v_sup);
  v_audits_before := (select count(*) from public.audit_log where action = 'supporter.todays_doses_viewed' and entity_id = v_pat);
  v_doc := public.supporter_todays_doses(v_pat);
  v_res := v_res || jsonb_build_array(jsonb_build_array('a supporter with the medicines category reads today''s doses', 'ok:2:taken,none',
    (v_doc ->> 'status') || ':' || jsonb_array_length(v_doc -> 'doses')::text || ':' ||
    coalesce((select string_agg(d ->> 'answer', ',' order by d ->> 'time') from jsonb_array_elements(v_doc -> 'doses') d), '')));
  v_res := v_res || jsonb_build_array(jsonb_build_array('the supporter''s read is audited', 'true',
    ((select count(*) from public.audit_log where action = 'supporter.todays_doses_viewed' and entity_id = v_pat) > v_audits_before)::text));
  execute 'reset role';

  perform pg_temp.as_user(v_sup_nocat);
  v_res := v_res || jsonb_build_array(jsonb_build_array('control: clinical_access plus view_medication WITHOUT the category is refused', 'not_shared',
    public.supporter_todays_doses(v_pat) ->> 'status'));
  execute 'reset role';
  perform pg_temp.as_user(v_stranger);
  v_res := v_res || jsonb_build_array(jsonb_build_array('control: a stranger is refused', 'not_shared', public.supporter_todays_doses(v_pat) ->> 'status'));
  execute 'reset role';
  perform pg_temp.as_user(v_sup_other);
  v_res := v_res || jsonb_build_array(jsonb_build_array('control: a supporter of someone else is refused', 'not_shared', public.supporter_todays_doses(v_pat) ->> 'status'));
  execute 'reset role';
  perform pg_temp.as_user(v_pat);
  v_res := v_res || jsonb_build_array(jsonb_build_array('control: the person is not answered as a supporter', 'not_shared', public.supporter_todays_doses(v_pat) ->> 'status'));
  execute 'reset role';
  perform pg_temp.as_user(v_sup_real);
  v_res := v_res || jsonb_build_array(jsonb_build_array('guard closed (ordinary account): nothing is shown even with the category', 'closed',
    public.supporter_todays_doses(v_pat) ->> 'status'));
  execute 'reset role';
  -- the category is withdrawn: access ends at once
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  delete from public.profile_access_categories where profile_access_id = (select id from public.profile_access where grantee_user_id = v_sup and profile_id = v_pat);
  perform pg_temp.as_user(v_sup);
  v_res := v_res || jsonb_build_array(jsonb_build_array('withdrawing the category ends the access at once', 'not_shared',
    public.supporter_todays_doses(v_pat) ->> 'status'));
  execute 'reset role';

  -- 6. anon ---------------------------------------------------------------------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  execute 'set local role anon';
  v_res := v_res || jsonb_build_array(jsonb_build_array('anon cannot read the brand map', '42501', pg_temp.attempt('select 1 from public.medicine_brand_generic_map')));
  v_res := v_res || jsonb_build_array(jsonb_build_array('anon cannot execute the supporter door', '42501', pg_temp.attempt(format('select public.supporter_todays_doses(%L)', v_pat))));
  v_res := v_res || jsonb_build_array(jsonb_build_array('anon cannot execute the rules door', '42501', pg_temp.attempt('select public.active_medicine_interaction_rules()')));
  execute 'reset role';

  insert into results select p_phase, e->>0, e->>1, e->>2 from jsonb_array_elements(v_res) e;
end
$f$;

select pg_temp.run_checks('real');

-- Put the shipped state back so the second phase starts where the first did.
update public.medicine_interaction_rule_sets set is_active = false;
delete from public.medicine_interaction_rule_sets where version > 1;
update public.medicine_interaction_rule_sets set approved_by = null, approved_at = null where version = 1;
delete from public.medicine_brand_generic_map;

-- SABOTAGE. The supporter door forgets the category check and the twin goes blind; the matching checks must flip.
create or replace function public.supporter_todays_doses(p_patient uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if p_patient = (select auth.uid()) then return jsonb_build_object('status', 'not_shared'); end if;
  return jsonb_build_object('status', 'ok', 'date', current_date, 'doses', '[]'::jsonb);
end $$;
create or replace function private.duplicate_ingredient_pairs(p_items jsonb)
returns table (a text, b text, shared text[]) language sql immutable set search_path = '' as $$ select null::text, null::text, null::text[] where false $$;
select pg_temp.run_checks('sabotaged');

do $$
declare v_bad text; v_caught text;
begin
  select string_agg(check_name || ' => ' || coalesce(actual, 'NULL') || ' (wanted ' || expected || ')', '; ') into v_bad
    from results where phase = 'real' and expected is distinct from actual;
  if v_bad is not null then raise exception 'S08y proof FAILED on the real migration: %', v_bad; end if;
  select string_agg(check_name, '; ') into v_caught from results where phase = 'sabotaged' and expected is distinct from actual;
  if v_caught is null then raise exception 'VACUOUS TEST: the sabotaged door and twin did not fail any check'; end if;
  if v_caught not like '%control: a stranger is refused%' or v_caught not like '%control: clinical_access plus view_medication WITHOUT the category is refused%'
     or v_caught not like '%twin: same generic twice%' then
    raise exception 'sabotage did not flip the category and twin checks; flipped: %', v_caught;
  end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
