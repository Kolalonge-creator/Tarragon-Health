-- T2-11b (founder decision 2026-11-05, given in chat): close three gaps from the prescribing safety case before prescribing is switched on.
--
--  1. HZ-RX-03, interactions at signing. Until now the signing checks (private.prescription_safety_findings) covered a controlled
--     medicine, an allergy name match, an empty allergy list and the same drug already active, and nothing else. The signed
--     interaction dataset (S53, class pairs, `interactions` + `interaction_dataset_versions`) and the signed ingredient rule set
--     (S08y, `medicine_interaction_rule_sets`) ran only in the patient's own add-a-medicine flow, as advice. Now the new drug is checked
--     at signing against the patient's current active medicines with both SIGNED sets, using the same matching the apps use:
--       * drug classes: the add check's own patterns (`CLASS_PATTERNS` in packages/medicines/src/safety/drug-safety.ts), copied here
--         into private.drug_class_patterns; `class-patterns-sql.test.ts` fails if the copy and the code ever differ.
--       * ingredients: the published brand map, then the catalogue brand, then the typed name, split by private.split_ingredients
--         (the twin the S08y work already keeps in step with the TypeScript splitter).
--     Severity decides what happens: contraindicated is a hard stop with no override; caution stops the signing until the doctor gives
--     a reason (the same override as the allergy stop, stored on the prescription in `safety_checks` and written to the audit log);
--     info is shown and stored but does not stop. Fail closed: with no signed dataset (whose content still hashes to the signed hash)
--     and no active signed rule set, nothing can be signed (SAFETY_CHECK_UNAVAILABLE). Both are signed live (2026-11-03).
--     Allergy class matching uses the same patterns: an allergen that classifies into the same class as the new drug (penicillin
--     allergy, amoxicillin) stops the signing until the doctor gives a reason. Nothing beyond the existing patterns was invented.
--     A class duplicate is not raised against the very same drug name (that is the existing duplicate_active finding).
--  2. HZ-RX-05, a lapsed or unverified licence. private.prescriber_licence_ok(profile) is the one test (active senior doctor, verified,
--     unexpired licence, a real credential number, the same placeholder words the PDF refuses). Signing (draft to signed, in
--     private.enforce_prescription_rules, patched from its LIVE body at an anchor) refuses `prescriber_licence_not_verified` when it
--     fails, and private.prescriber_ready_count() (the master's condition) now counts with the same test.
--  3. HZ-RX-06/11, a pharmacist without a camera. public.verify_prescription_by_code(rx_number, code) returns the QR token for a
--     matching clinician prescription, so /verify-rx can send the pharmacist to the same minimal page the QR opens. Ten wrong codes for
--     one Rx number in an hour lock lookups for that number for the hour (the QR keeps working); the app also rate limits per address.
--
-- Not changed: the controlled-medicine stop, the allergy name stop, tier authority (private.has_prescribing_authority), the test-pair
-- rule of the prescribing master, the PDF issuing rules.

-- 1a. The drug-class patterns, copied from the add check -------------------------------------------------------------------------
create table if not exists private.drug_class_patterns (
  ordinal integer primary key,
  cls text not null,
  pattern text not null
);
comment on table private.drug_class_patterns is
  'T2-11b: the add check''s CLASS_PATTERNS (packages/medicines/src/safety/drug-safety.ts), with \b written as \y for Postgres. Written only by migrations; class-patterns-sql.test.ts keeps this copy and the code identical.';
alter table private.drug_class_patterns enable row level security;   -- no policies: read only by the security-definer functions below
revoke all on private.drug_class_patterns from public, anon, authenticated;

delete from private.drug_class_patterns;
insert into private.drug_class_patterns (ordinal, cls, pattern) values
  (1, 'ccb_non_dihydropyridine', '\y(verapamil|diltiazem)\y'),
  (2, 'ccb_dihydropyridine', '(amlodipine|nifedipine|felodipine|lercanidipine|nimodipine|\w+dipine)\y'),
  (3, 'ace_inhibitor', '(lisinopril|ramipril|enalapril|perindopril|captopril|\w+pril)\y'),
  (4, 'arb', '(losartan|valsartan|telmisartan|irbesartan|candesartan|olmesartan|\w+sartan)\y'),
  (5, 'beta_blocker', '(atenolol|bisoprolol|metoprolol|propranolol|carvedilol|nebivolol|labetalol|\w+olol)\y'),
  (6, 'potassium_sparing_diuretic', '\y(spironolactone|eplerenone|amiloride|triamterene)\y'),
  (7, 'thiazide_diuretic', '\y(hydrochlorothiazide|hctz|bendroflumethiazide|indapamide|chlortalidone|chlorthalidone|metolazone)\y'),
  (8, 'loop_diuretic', '\y(furosemide|frusemide|bumetanide|torasemide|torsemide)\y'),
  (9, 'potassium_supplement', '(potassium chloride|\ykcl\y|slow[- ]?k|potassium supplement)'),
  (10, 'statin', '(atorvastatin|simvastatin|rosuvastatin|pravastatin|fluvastatin|lovastatin|pitavastatin|\w+statin|statins?)\y'),
  (11, 'fibrate', '\y(gemfibrozil|fenofibrate|bezafibrate|ciprofibrate)\y'),
  (12, 'antiplatelet', '\y(aspirin|acetylsalicylic|asa|clopidogrel|ticagrelor|prasugrel|dipyridamole)\y'),
  (13, 'nsaid', '\y(ibuprofen|diclofenac|naproxen|indomethacin|indometacin|piroxicam|meloxicam|celecoxib|etoricoxib|ketoprofen|mefenamic|nimesulide|aceclofenac|nsaids?)\y'),
  (14, 'anticoagulant', '\y(warfarin|acenocoumarol|rivaroxaban|apixaban|dabigatran|edoxaban|enoxaparin|heparin)\y'),
  (15, 'ssri', '\y(fluoxetine|sertraline|paroxetine|citalopram|escitalopram|fluvoxamine)\y'),
  (16, 'tramadol_opioid', '\y(tramadol|codeine|morphine|pethidine|tapentadol|oxycodone|opioids?|co-?codamol)\y'),
  (17, 'macrolide', '\y(clarithromycin|erythromycin|azithromycin)\y'),
  (18, 'fluoroquinolone', '(ciprofloxacin|levofloxacin|moxifloxacin|ofloxacin|norfloxacin|\w+floxacin)\y'),
  (19, 'penicillin', '\y(penicillin|amoxicillin|ampicillin|flucloxacillin|cloxacillin|dicloxacillin|piperacillin|augmentin|co-?amoxiclav|benzylpenicillin|phenoxymethylpenicillin)\y'),
  (20, 'cephalosporin', '\y(cephalosporin|cefuroxime|ceftriaxone|cefixime|cefpodoxime|cefotaxime|ceftazidime|cefaclor|cefadroxil|cefalexin|cephalexin|cefdinir|cefepime)\y'),
  (21, 'azole_antifungal', '(fluconazole|itraconazole|ketoconazole|voriconazole|\w+conazole)\y'),
  (22, 'nitroimidazole', '\y(metronidazole|tinidazole|secnidazole)\y'),
  (23, 'antimalarial_act', '(artemether|lumefantrine|artesunate|amodiaquine|dihydroartemisinin|arteether|coartem)'),
  (24, 'digoxin', '\y(digoxin|digitoxin)\y'),
  (25, 'levothyroxine', '\y(levothyroxine|thyroxine|eltroxin|l[- ]?thyroxine)\y'),
  (26, 'metformin', '\y(metformin|glucophage)\y'),
  (27, 'sulfonylurea', '\y(gliclazide|glibenclamide|glimepiride|glipizide|glyburide)\y'),
  (28, 'sglt2', '(empagliflozin|dapagliflozin|canagliflozin|ertugliflozin|\w+gliflozin)\y'),
  (29, 'dpp4', '(sitagliptin|vildagliptin|linagliptin|saxagliptin|alogliptin|\w+gliptin)\y'),
  (30, 'insulin', '\y(insulin|lantus|levemir|humulin|actrapid|mixtard|novomix|tresiba)\y'),
  (31, 'ppi', '(omeprazole|esomeprazole|pantoprazole|lansoprazole|rabeprazole|\w+prazole)\y'),
  (32, 'allopurinol', '\y(allopurinol|febuxostat)\y'),
  (33, 'colchicine', '\y(colchicine)\y'),
  (34, 'methotrexate', '\y(methotrexate|mtx)\y'),
  (35, 'gabapentinoid', '\y(gabapentin|pregabalin)\y'),
  (36, 'nitrofurantoin', '\y(nitrofurantoin|macrodantin|macrobid)\y'),
  (37, 'cotrimoxazole', '\y(co[- ]?trimoxazole|cotrimoxazole|trimethoprim|sulfamethoxazole|septrin|bactrim|sulfa|sulfonamide|sulphonamide)\y'),
  (38, 'aminoglycoside', '\y(gentamicin|amikacin|tobramycin|streptomycin)\y'),
  (39, 'lithium', '\y(lithium)\y'),
  (40, 'amiodarone', '\y(amiodarone|dronedarone)\y'),
  (41, 'antipsychotic', '\y(haloperidol|olanzapine|risperidone|quetiapine|chlorpromazine|aripiprazole)\y'),
  (42, 'calcium_or_iron_supplement', '(calcium carbonate|calcium supplement|ferrous (sulphate|sulfate|fumarate|gluconate)|iron supplement|\yferrous\y)');

-- The classes a free-text drug name belongs to (combination products give several). Same normalising as the TypeScript classifyDrug.
create or replace function private.drug_classes(p_name text) returns text[]
language sql stable security definer set search_path = '' as $$
  with n as (
    select btrim(regexp_replace(regexp_replace(lower(coalesce(p_name, '')), '[.,()/\\]+', ' ', 'g'), '\s+', ' ', 'g')) as v
  )
  select coalesce(array_agg(distinct p.cls order by p.cls) filter (where n.v <> '' and n.v ~ p.pattern), '{}'::text[])
    from private.drug_class_patterns p cross join n
$$;
revoke all on function private.drug_classes(text) from public, anon, authenticated;

-- The ingredients a typed name stands for: the longest published brand it equals or starts with, then a catalogue brand, else itself.
create or replace function private.drug_ingredients(p_name text) returns text[]
language sql stable security definer set search_path = '' as $$
  with n as (select coalesce(private.normalise_term(p_name), '') as v),
  brand as (
    select array_to_string(m.ingredients, ' and ') as generic, length(private.normalise_term(m.brand_name)) as len
      from public.medicine_brand_generic_map m, n
     where m.is_active and m.reviewed_by is not null and m.reviewed_at is not null and nullif(btrim(m.source_citation), '') is not null
       and private.normalise_term(m.brand_name) is not null
       and (n.v = private.normalise_term(m.brand_name) or n.v like private.normalise_term(m.brand_name) || ' %')
     order by 2 desc limit 1
  ),
  cat as (
    select c.generic_name as generic, length(private.normalise_term(c.brand_name)) as len
      from public.medicine_catalogue c, n
     where c.is_active and c.brand_name is not null and private.normalise_term(c.brand_name) is not null
       and (n.v = private.normalise_term(c.brand_name) or n.v like private.normalise_term(c.brand_name) || ' %')
     order by 2 desc limit 1
  )
  select private.split_ingredients(coalesce((select generic from brand), (select generic from cat), p_name))
$$;
revoke all on function private.drug_ingredients(text) from public, anon, authenticated;

-- The signed sets the signing check reads. Null when none is signed (the check then fails closed).
create or replace function private.signed_interaction_dataset_version() returns integer
language sql stable security definer set search_path = '' as $$
  select max(v.version) from public.interaction_dataset_versions v
   where v.status = 'approved' and v.signed_by is not null and v.content_hash = private.interaction_dataset_hash(v.version)
$$;
revoke all on function private.signed_interaction_dataset_version() from public, anon, authenticated;

create or replace function private.signed_interaction_rule_set() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('version', r.version, 'rules', r.config -> 'rules')
    from public.medicine_interaction_rule_sets r
   where r.is_active and r.approved_by is not null and r.approved_at is not null and jsonb_array_length(r.config -> 'rules') > 0
   order by r.version desc limit 1
$$;
revoke all on function private.signed_interaction_rule_set() from public, anon, authenticated;

-- 1b. The interaction findings for one new drug against the patient's current list ---------------------------------------------------
create or replace function private.prescription_interaction_findings(p_patient uuid, p_drug text, p_replacing uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_ds integer := private.signed_interaction_dataset_version();
  v_rs jsonb := private.signed_interaction_rule_set();
  v_cls text[] := private.drug_classes(p_drug);
  v_ing text[] := private.drug_ingredients(p_drug);
  v_name text := lower(btrim(coalesce(p_drug, '')));
  v_f jsonb := '[]'::jsonb;
  m record;
  r record;
  m_cls text[];
  m_ing text[];
begin
  if v_ds is null or v_rs is null then
    return null;   -- the caller fails closed
  end if;
  for m in select x.id, x.drug_name from public.medications x
            where x.patient_id = p_patient and x.is_active and x.superseded_at is null and x.id is distinct from p_replacing loop
    m_cls := private.drug_classes(m.drug_name);
    m_ing := private.drug_ingredients(m.drug_name);
    -- the signed S53 dataset: class pairs, and two medicines of one class
    for r in select i.rule_code, i.kind, i.severity, i.title from public.interactions i
              where i.dataset_version = v_ds
                and ((i.kind = 'interaction' and ((i.drug_a = any (v_cls) and i.drug_b = any (m_cls)) or (i.drug_b = any (v_cls) and i.drug_a = any (m_cls))))
                  or (i.kind = 'duplicate' and i.drug_a = any (v_cls) and i.drug_a = any (m_cls) and lower(btrim(m.drug_name)) <> v_name)) loop
      v_f := v_f || jsonb_build_array(jsonb_build_object(
        'code', 'interaction', 'source', 'dataset', 'rule', r.rule_code, 'kind', r.kind, 'severity', r.severity, 'title', r.title,
        'with', m.drug_name, 'blocking', r.severity = 'contraindicated', 'advisory', r.severity = 'info'));
    end loop;
    -- the signed S08y rule set: ingredient pairs, held by two different medicines
    for r in select e ->> 'code' as code, e ->> 'severity' as severity
               from jsonb_array_elements(v_rs -> 'rules') e
              where ((e ->> 'ingredientA') = any (v_ing) and (e ->> 'ingredientB') = any (m_ing))
                 or ((e ->> 'ingredientB') = any (v_ing) and (e ->> 'ingredientA') = any (m_ing)) loop
      v_f := v_f || jsonb_build_array(jsonb_build_object(
        'code', 'interaction', 'source', 'rule_set', 'rule', r.code, 'kind', 'interaction', 'severity', r.severity, 'title', null,
        'with', m.drug_name, 'blocking', r.severity = 'contraindicated', 'advisory', r.severity = 'info'));
    end loop;
  end loop;
  return v_f;
end $$;
revoke all on function private.prescription_interaction_findings(uuid, text, uuid) from public, anon, authenticated;

-- 1c. The signing findings, from the live body plus the class allergy match and the interactions ----------------------------------
create or replace function private.prescription_safety_findings(p_patient uuid, p_drug text, p_replacing uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_f jsonb := '[]'::jsonb;
  v_name text := lower(btrim(coalesce(p_drug, '')));
  v_cls text[] := private.drug_classes(p_drug);
  v_inter jsonb;
  r record;
begin
  -- TarragonHealth does not prescribe these (the prescription PDF says so). A hard stop: no override. The list is private.is_controlled_medicine.
  if private.is_controlled_medicine(v_name) then
    v_f := v_f || jsonb_build_array(jsonb_build_object('code', 'controlled_medicine', 'blocking', true));
  end if;
  for r in select allergen from private.patient_allergies_current
            where patient_id = p_patient and length(btrim(allergen)) >= 3 and strpos(v_name, lower(btrim(allergen))) > 0 loop
    v_f := v_f || jsonb_build_array(jsonb_build_object('code', 'allergy_match', 'allergen', r.allergen));
  end loop;
  -- T2-11b: an allergen in the same drug class as the new medicine (penicillin allergy, amoxicillin), unless already matched by name
  for r in select a.allergen, (select min(c) from unnest(private.drug_classes(a.allergen)) c where c = any (v_cls)) as cls
             from private.patient_allergies_current a
            where a.patient_id = p_patient and length(btrim(a.allergen)) >= 3 and strpos(v_name, lower(btrim(a.allergen))) = 0
              and private.drug_classes(a.allergen) && v_cls loop
    v_f := v_f || jsonb_build_array(jsonb_build_object('code', 'allergy_class_match', 'allergen', r.allergen, 'drug_class', r.cls));
  end loop;
  if not exists (select 1 from private.patient_allergies_current where patient_id = p_patient) then
    v_f := v_f || jsonb_build_array(jsonb_build_object('code', 'allergies_unrecorded'));
  end if;
  if exists (select 1 from public.medications m
              where m.patient_id = p_patient and m.is_active and m.superseded_at is null
                and lower(btrim(m.drug_name)) = v_name and m.id is distinct from p_replacing) then
    v_f := v_f || jsonb_build_array(jsonb_build_object('code', 'duplicate_active'));
  end if;
  v_inter := private.prescription_interaction_findings(p_patient, p_drug, p_replacing);
  if v_inter is null then
    v_f := v_f || jsonb_build_array(jsonb_build_object('code', 'interaction_check_unavailable', 'unavailable', true));
  else
    v_f := v_f || v_inter;
  end if;
  return v_f;
end $$;
revoke all on function private.prescription_safety_findings(uuid, text, uuid) from public, anon, authenticated;

-- 1d. The signing gate: hard stops, reasons, advisories, fail closed, audit (volatile now, it writes the audit row) ----------------
create or replace function private.check_prescription_safety(p_patient uuid, p_drug text, p_replacing uuid, p_allergies_confirmed boolean, p_override text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_findings jsonb := private.prescription_safety_findings(p_patient, p_drug, p_replacing);
  v_open jsonb;
  v_reason text := nullif(btrim(coalesce(p_override, '')), '');
begin
  if exists (select 1 from jsonb_array_elements(v_findings) e where (e ->> 'unavailable')::boolean is true) then
    raise exception 'The interaction check cannot run because no signed interaction dataset and rule set are active, so nothing can be signed. Ask the Chief Medical Officer to check the signed sets.'
      using errcode = 'P0001', detail = 'SAFETY_CHECK_UNAVAILABLE', hint = v_findings::text;
  end if;
  if exists (select 1 from jsonb_array_elements(v_findings) e where e ->> 'code' = 'controlled_medicine') then
    raise exception 'TarragonHealth does not prescribe controlled medicines, so this cannot be signed here.'
      using errcode = 'P0001', detail = 'SAFETY_BLOCKED', hint = v_findings::text;
  end if;
  if exists (select 1 from jsonb_array_elements(v_findings) e where (e ->> 'blocking')::boolean is true) then
    raise exception 'This medicine must not be given with a medicine the patient already takes (a contraindicated pair in the signed interaction rules), so it cannot be signed. Stop or change the other medicine first, or choose a different one.'
      using errcode = 'P0001', detail = 'SAFETY_BLOCKED', hint = v_findings::text;
  end if;
  select coalesce(jsonb_agg(e), '[]'::jsonb) into v_open
    from jsonb_array_elements(v_findings) e
   where not (e ->> 'code' = 'allergies_unrecorded' and coalesce(p_allergies_confirmed, false))
     and not coalesce((e ->> 'advisory')::boolean, false);
  if jsonb_array_length(v_open) > 0 and v_reason is null then
    raise exception 'A safety check needs your attention before this can be signed.'
      using errcode = 'P0001', detail = 'SAFETY_FINDINGS', hint = v_open::text;
  end if;
  if jsonb_array_length(v_open) > 0 then
    perform private.log_audit('prescription.safety_override', 'patient', p_patient,
      jsonb_build_object('drug', p_drug, 'findings', v_open, 'reason', v_reason,
                         'dataset_version', private.signed_interaction_dataset_version(),
                         'rule_set_version', private.signed_interaction_rule_set() -> 'version'));
  end if;
  return jsonb_build_object('findings', v_findings, 'allergies_confirmed', coalesce(p_allergies_confirmed, false),
                            'override_reason', v_reason, 'checked_at', now(),
                            'interaction_dataset_version', private.signed_interaction_dataset_version(),
                            'interaction_rule_set_version', private.signed_interaction_rule_set() -> 'version');
end $$;
revoke all on function private.check_prescription_safety(uuid, text, uuid, boolean, text) from public, anon, authenticated;

-- 2. The prescriber's licence ---------------------------------------------------------------------------------------------------
create or replace function private.prescriber_licence_ok(p_profile uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.clinical_staff cs
     where cs.profile_id = p_profile and cs.active
       and cs.doctor_tier in ('senior_medical_officer', 'chief_medical_officer')
       and cs.license_verified_at is not null and (cs.license_expires_at is null or cs.license_expires_at > now())
       and cs.credential_type is not null and nullif(btrim(cs.credential_number), '') is not null
       -- the same placeholder words the prescription PDF refuses (isPlaceholderCredentialNumber)
       and cs.credential_number !~* '\m(pending|placeholder|tbc|tbd|none|unknown|test)\M'
       and cs.credential_number !~* '\mn/a\M')
$$;
revoke all on function private.prescriber_licence_ok(uuid) from public, anon;
-- the signing trigger (private.enforce_prescription_rules) runs as the signed-in clinician, so it needs to call this
grant execute on function private.prescriber_licence_ok(uuid) to authenticated;

create or replace function private.prescriber_ready_count() returns integer
language sql stable security definer set search_path = '' as $$
  select count(distinct cs.profile_id)::integer from public.clinical_staff cs
   where cs.is_test is not true and private.prescriber_licence_ok(cs.profile_id)
$$;
revoke all on function private.prescriber_ready_count() from public, anon, authenticated;

do $patch$
declare
  v_def text := pg_get_functiondef('private.enforce_prescription_rules()'::regprocedure);
  v_anchor constant text := E'      raise exception ''prescribing_guard_off'' using errcode = ''55000'';\n    end if;\n';
  v_add constant text := E'    -- T2-11b (HZ-RX-05): the signer''s licence must be verified, unexpired and carry a real number (private.prescriber_licence_ok).\n'
                       || E'    if v_uid is not null and old.state = ''draft'' and new.state = ''signed'' and not private.prescriber_licence_ok(v_uid) then\n'
                       || E'      raise exception ''prescriber_licence_not_verified'' using errcode = ''42501'';\n'
                       || E'    end if;\n';
begin
  if v_def like '%prescriber_licence_not_verified%' then return; end if;
  if position(v_anchor in v_def) = 0 then
    raise exception 'private.enforce_prescription_rules no longer has the prescribing guard anchor; add the T2-11b licence check by hand' using errcode = '55000';
  end if;
  execute replace(v_def, v_anchor, v_anchor || v_add);
end $patch$;

-- 3. Enter the code at /verify-rx ------------------------------------------------------------------------------------------------
create table if not exists private.prescription_code_lookup_failures (
  id bigint generated always as identity primary key,
  rx_number text not null,
  at timestamptz not null default now()
);
create index if not exists prescription_code_lookup_failures_rx_at on private.prescription_code_lookup_failures (rx_number, at desc);
alter table private.prescription_code_lookup_failures enable row level security;   -- no policies: written only by verify_prescription_by_code
revoke all on private.prescription_code_lookup_failures from public, anon, authenticated;

create or replace function public.verify_prescription_by_code(p_rx_number text, p_code text) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_rx text := upper(regexp_replace(coalesce(p_rx_number, ''), '\s+', '', 'g'));
  v_code text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  v_token text;
begin
  if v_rx !~ '^[A-Z0-9-]{4,40}$' or v_code !~ '^[A-Z0-9]{4,12}$' then
    return null;
  end if;
  if (select count(*) from private.prescription_code_lookup_failures f where f.rx_number = v_rx and f.at > now() - interval '1 hour') >= 10 then
    raise exception 'too_many_attempts' using errcode = 'P0001';
  end if;
  select m.public_token into v_token from public.medications m
   where upper(m.rx_number) = v_rx and upper(m.verification_code) = v_code and m.source = 'clinician' and m.public_token is not null
   order by m.version desc limit 1;
  if v_token is null then
    insert into private.prescription_code_lookup_failures (rx_number) values (v_rx);
  end if;
  return v_token;
end $$;
revoke all on function public.verify_prescription_by_code(text, text) from public;
grant execute on function public.verify_prescription_by_code(text, text) to anon, authenticated;
comment on function public.verify_prescription_by_code(text, text) is
  'T2-11b: the Rx number and verification code printed on a prescription give the same QR token the code on the form opens; /verify-rx then shows the same minimal page. Ten wrong codes for one Rx number in an hour lock that number for the hour.';

-- The guard's own account ------------------------------------------------------------------------------------------------------
update public.go_live_guards set
  enforced_in = array['private.enforce_prescription_rules (signing a prescription, draft to signed, for a signed-in clinician; the signer''s licence is checked there too)',
                      'private.pharmacy_collection_on (every partner-pharmacy choice, list, counter check, supply and question; also needs private.pharmacy_partner_collection_ready)']
where key = 'prescribing_enabled';

-- The migration proves what it claims -----------------------------------------------------------------------------------------
do $$
declare v_def text := pg_get_functiondef('private.enforce_prescription_rules()'::regprocedure);
begin
  if (select count(*) from private.drug_class_patterns) < 40 then raise exception 'T2-11b: the class patterns were not copied'; end if;
  if private.drug_classes('Amoxicillin 500mg capsules') <> array['penicillin'] then raise exception 'T2-11b: amoxicillin is not a penicillin here'; end if;
  if not (private.drug_classes('Lisinopril/HCTZ') @> array['ace_inhibitor', 'thiazide_diuretic']) then raise exception 'T2-11b: a combination is not split into its classes'; end if;
  if private.drug_classes('Vitamin C') <> '{}'::text[] then raise exception 'T2-11b: an unrelated name was classified'; end if;
  if position('prescriber_licence_not_verified' in v_def) = 0 then raise exception 'T2-11b: the licence check is not in the signing trigger'; end if;
  if has_function_privilege('anon', 'private.check_prescription_safety(uuid,text,uuid,boolean,text)', 'EXECUTE') then raise exception 'anon can call check_prescription_safety'; end if;
  if has_function_privilege('anon', 'private.prescriber_licence_ok(uuid)', 'EXECUTE') then raise exception 'anon can call prescriber_licence_ok'; end if;
  if not has_function_privilege('authenticated', 'private.prescriber_licence_ok(uuid)', 'EXECUTE') then raise exception 'the signing trigger cannot call prescriber_licence_ok'; end if;
  if not has_function_privilege('anon', 'public.verify_prescription_by_code(text,text)', 'EXECUTE') then raise exception 'anon cannot check a code'; end if;
  if exists (select 1 from public.go_live_guards where key = 'prescribing_enabled' and is_on)
     and not exists (select 1 from public.go_live_guard_log where guard_key = 'prescribing_enabled' and action = 'switched_on') then
    raise exception 'T2-11b: prescribing_enabled is on with no switched_on log row';
  end if;
end $$;
