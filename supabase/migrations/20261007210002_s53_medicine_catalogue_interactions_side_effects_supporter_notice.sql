-- S53: Module 8 (1 of 2): medicine catalogue (8.2), interaction and duplication dataset with its sign-off gate (8.7, D6),
-- side-effect notes carried to the next consultation (8.7), a neutral in-app notice to a consented supporter on a missed dose (8.4, 8.6).
-- INV-02 (nothing here edits a prescription), INV-07 (every notice is generic), INV-10 (staff reads of notes are audited),
-- INV-13 (is_test carried), INV-14 (the new check is behind a go-live guard that stays OFF).
--
-- LIVE COUNTS READ 2026-10-07 (read-only): medications and pharmacy_medications 0 rows; no table named medicine_catalogue, interactions
-- or medication_side_effect_notes; go_live_guards has the seven S37 rows. Nothing to convert.
--
-- WHAT THIS DOES NOT DO
--   * It does not sign or approve anything. interaction_dataset_versions v1 is inserted as a DRAFT with no signer. The guard
--     interaction_check_enabled is inserted OFF. sign_interaction_dataset() exists for the Chief Medical Officer to run after a
--     pharmacist has reviewed docs/clinical/interaction-dataset-v1.md; nobody calls it here.
--   * It does not invent a NAFDAC number. Every catalogue row has nafdac_number null, is_verified false and needs_pharmacist_review
--     true. A row may only become is_verified when a number is present (CHECK).
--   * The catalogue seed is generic (INN) names with strengths and forms that are standard, plus a short list of brands whose
--     generic is beyond doubt. It is a convenience for search-as-you-type, never an assertion that a product is registered.

-- ---------------------------------------------------------------------------
-- 1. Medicine catalogue (8.2)
-- ---------------------------------------------------------------------------
create table public.medicine_catalogue (
  id                      uuid primary key default gen_random_uuid(),
  brand_name              text check (brand_name is null or char_length(btrim(brand_name)) between 1 and 80),
  generic_name            text not null check (char_length(btrim(generic_name)) between 2 and 120),
  strength                text check (strength is null or char_length(strength) <= 60),
  form                    text check (form is null or char_length(form) <= 40),
  nafdac_number           text check (nafdac_number is null or char_length(btrim(nafdac_number)) between 4 and 30),
  source                  text not null check (char_length(btrim(source)) >= 3),
  version                 integer not null default 1 check (version >= 1),
  is_verified             boolean not null default false,
  needs_pharmacist_review boolean not null default true,
  is_active               boolean not null default true,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint medicine_catalogue_verified_needs_number check (not is_verified or nafdac_number is not null)
);
comment on table public.medicine_catalogue is
  'S53 8.2: brands and generics for search-as-you-type on the add-a-medicine form. A suggestion fills the form; the patient confirms every field. nafdac_number is only ever copied from the NAFDAC register by a pharmacist; it is never guessed. is_verified requires a number.';
create index medicine_catalogue_generic_idx on public.medicine_catalogue (lower(generic_name));
create index medicine_catalogue_brand_idx on public.medicine_catalogue (lower(brand_name)) where brand_name is not null;

alter table public.medicine_catalogue enable row level security;
revoke all on public.medicine_catalogue from public, anon;
grant select, insert, update on public.medicine_catalogue to authenticated;
create policy medicine_catalogue_read on public.medicine_catalogue for select to authenticated
  using (is_active or private.is_admin() or private.has_permission('partners.pharmacies.manage'::text));
create policy medicine_catalogue_insert on public.medicine_catalogue for insert to authenticated
  with check (private.is_admin() or private.has_permission('partners.pharmacies.manage'::text));
create policy medicine_catalogue_update on public.medicine_catalogue for update to authenticated
  using (private.is_admin() or private.has_permission('partners.pharmacies.manage'::text))
  with check (private.is_admin() or private.has_permission('partners.pharmacies.manage'::text));

create or replace function private.medicine_catalogue_touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;
create trigger medicine_catalogue_touch before update on public.medicine_catalogue
  for each row execute function private.medicine_catalogue_touch();

-- Seed 1: generic (INN) names, standard strengths and forms
insert into public.medicine_catalogue (generic_name, strength, form, source) values
  ('Amlodipine', '5 mg', 'tablet', 'tarragon_curated_generics_v1'),
  ('Amlodipine', '10 mg', 'tablet', 'tarragon_curated_generics_v1'),
  ('Lisinopril', '5 mg', 'tablet', 'tarragon_curated_generics_v1'),
  ('Lisinopril', '10 mg', 'tablet', 'tarragon_curated_generics_v1'),
  ('Lisinopril', '20 mg', 'tablet', 'tarragon_curated_generics_v1'),
  ('Enalapril', '5 mg', 'tablet', 'tarragon_curated_generics_v1'),
  ('Enalapril', '10 mg', 'tablet', 'tarragon_curated_generics_v1'),
  ('Ramipril', '5 mg', 'tablet', 'tarragon_curated_generics_v1'),
  ('Losartan', '50 mg', 'tablet', 'tarragon_curated_generics_v1'),
  ('Losartan', '100 mg', 'tablet', 'tarragon_curated_generics_v1'),
  ('Valsartan', '80 mg', 'tablet', 'tarragon_curated_generics_v1'),
  ('Valsartan', '160 mg', 'tablet', 'tarragon_curated_generics_v1'),
  ('Telmisartan', '40 mg', 'tablet', 'tarragon_curated_generics_v1'),
  ('Hydrochlorothiazide', '25 mg', 'tablet', 'tarragon_curated_generics_v1'),
  ('Indapamide', '1.5 mg', 'modified-release tablet', 'tarragon_curated_generics_v1'),
  ('Furosemide', '40 mg', 'tablet', 'tarragon_curated_generics_v1'),
  ('Spironolactone', '25 mg', 'tablet', 'tarragon_curated_generics_v1'),
  ('Atenolol', '50 mg', 'tablet', 'tarragon_curated_generics_v1'),
  ('Bisoprolol', '5 mg', 'tablet', 'tarragon_curated_generics_v1'),
  ('Metoprolol', '50 mg', 'tablet', 'tarragon_curated_generics_v1'),
  ('Nifedipine', '20 mg', 'modified-release tablet', 'tarragon_curated_generics_v1'),
  ('Methyldopa', '250 mg', 'tablet', 'tarragon_curated_generics_v1'),
  ('Metformin', '500 mg', 'tablet', 'tarragon_curated_generics_v1'),
  ('Metformin', '850 mg', 'tablet', 'tarragon_curated_generics_v1'),
  ('Metformin', '1000 mg', 'tablet', 'tarragon_curated_generics_v1'),
  ('Gliclazide', '80 mg', 'tablet', 'tarragon_curated_generics_v1'),
  ('Glibenclamide', '5 mg', 'tablet', 'tarragon_curated_generics_v1'),
  ('Glimepiride', '2 mg', 'tablet', 'tarragon_curated_generics_v1'),
  ('Sitagliptin', '100 mg', 'tablet', 'tarragon_curated_generics_v1'),
  ('Empagliflozin', '10 mg', 'tablet', 'tarragon_curated_generics_v1'),
  ('Insulin glargine', '100 units/ml', 'injection', 'tarragon_curated_generics_v1'),
  ('Atorvastatin', '10 mg', 'tablet', 'tarragon_curated_generics_v1'),
  ('Atorvastatin', '20 mg', 'tablet', 'tarragon_curated_generics_v1'),
  ('Atorvastatin', '40 mg', 'tablet', 'tarragon_curated_generics_v1'),
  ('Simvastatin', '20 mg', 'tablet', 'tarragon_curated_generics_v1'),
  ('Rosuvastatin', '10 mg', 'tablet', 'tarragon_curated_generics_v1'),
  ('Aspirin', '75 mg', 'tablet', 'tarragon_curated_generics_v1'),
  ('Clopidogrel', '75 mg', 'tablet', 'tarragon_curated_generics_v1'),
  ('Warfarin', '5 mg', 'tablet', 'tarragon_curated_generics_v1'),
  ('Paracetamol', '500 mg', 'tablet', 'tarragon_curated_generics_v1'),
  ('Ibuprofen', '400 mg', 'tablet', 'tarragon_curated_generics_v1'),
  ('Diclofenac', '50 mg', 'tablet', 'tarragon_curated_generics_v1'),
  ('Amoxicillin', '500 mg', 'capsule', 'tarragon_curated_generics_v1'),
  ('Amoxicillin and clavulanic acid', '625 mg', 'tablet', 'tarragon_curated_generics_v1'),
  ('Azithromycin', '500 mg', 'tablet', 'tarragon_curated_generics_v1'),
  ('Ciprofloxacin', '500 mg', 'tablet', 'tarragon_curated_generics_v1'),
  ('Metronidazole', '400 mg', 'tablet', 'tarragon_curated_generics_v1'),
  ('Co-trimoxazole', '480 mg', 'tablet', 'tarragon_curated_generics_v1'),
  ('Doxycycline', '100 mg', 'capsule', 'tarragon_curated_generics_v1'),
  ('Artemether and lumefantrine', '20 mg/120 mg', 'tablet', 'tarragon_curated_generics_v1'),
  ('Artesunate and amodiaquine', null, 'tablet', 'tarragon_curated_generics_v1'),
  ('Sulfadoxine and pyrimethamine', '500 mg/25 mg', 'tablet', 'tarragon_curated_generics_v1'),
  ('Omeprazole', '20 mg', 'capsule', 'tarragon_curated_generics_v1'),
  ('Levothyroxine', '50 micrograms', 'tablet', 'tarragon_curated_generics_v1'),
  ('Levothyroxine', '100 micrograms', 'tablet', 'tarragon_curated_generics_v1'),
  ('Salbutamol', '100 micrograms per dose', 'inhaler', 'tarragon_curated_generics_v1'),
  ('Prednisolone', '5 mg', 'tablet', 'tarragon_curated_generics_v1'),
  ('Folic acid', '5 mg', 'tablet', 'tarragon_curated_generics_v1'),
  ('Ferrous sulfate', '200 mg', 'tablet', 'tarragon_curated_generics_v1'),
  ('Loratadine', '10 mg', 'tablet', 'tarragon_curated_generics_v1'),
  ('Cetirizine', '10 mg', 'tablet', 'tarragon_curated_generics_v1'),
  ('Zinc sulfate', '20 mg', 'dispersible tablet', 'tarragon_curated_generics_v1'),
  ('Oral rehydration salts', null, 'sachet', 'tarragon_curated_generics_v1');

-- Seed 2: well-known brands whose generic is beyond doubt. No strengths, no numbers: those come from the pack or a pharmacist.
insert into public.medicine_catalogue (brand_name, generic_name, source) values
  ('Norvasc', 'Amlodipine', 'tarragon_curated_brands_v1'),
  ('Zestril', 'Lisinopril', 'tarragon_curated_brands_v1'),
  ('Cozaar', 'Losartan', 'tarragon_curated_brands_v1'),
  ('Tenormin', 'Atenolol', 'tarragon_curated_brands_v1'),
  ('Concor', 'Bisoprolol', 'tarragon_curated_brands_v1'),
  ('Lasix', 'Furosemide', 'tarragon_curated_brands_v1'),
  ('Aldactone', 'Spironolactone', 'tarragon_curated_brands_v1'),
  ('Glucophage', 'Metformin', 'tarragon_curated_brands_v1'),
  ('Diamicron', 'Gliclazide', 'tarragon_curated_brands_v1'),
  ('Januvia', 'Sitagliptin', 'tarragon_curated_brands_v1'),
  ('Jardiance', 'Empagliflozin', 'tarragon_curated_brands_v1'),
  ('Lantus', 'Insulin glargine', 'tarragon_curated_brands_v1'),
  ('Lipitor', 'Atorvastatin', 'tarragon_curated_brands_v1'),
  ('Zocor', 'Simvastatin', 'tarragon_curated_brands_v1'),
  ('Crestor', 'Rosuvastatin', 'tarragon_curated_brands_v1'),
  ('Plavix', 'Clopidogrel', 'tarragon_curated_brands_v1'),
  ('Panadol', 'Paracetamol', 'tarragon_curated_brands_v1'),
  ('Brufen', 'Ibuprofen', 'tarragon_curated_brands_v1'),
  ('Voltaren', 'Diclofenac', 'tarragon_curated_brands_v1'),
  ('Amoxil', 'Amoxicillin', 'tarragon_curated_brands_v1'),
  ('Augmentin', 'Amoxicillin and clavulanic acid', 'tarragon_curated_brands_v1'),
  ('Zithromax', 'Azithromycin', 'tarragon_curated_brands_v1'),
  ('Ciprobay', 'Ciprofloxacin', 'tarragon_curated_brands_v1'),
  ('Flagyl', 'Metronidazole', 'tarragon_curated_brands_v1'),
  ('Septrin', 'Co-trimoxazole', 'tarragon_curated_brands_v1'),
  ('Coartem', 'Artemether and lumefantrine', 'tarragon_curated_brands_v1'),
  ('Losec', 'Omeprazole', 'tarragon_curated_brands_v1'),
  ('Euthyrox', 'Levothyroxine', 'tarragon_curated_brands_v1'),
  ('Ventolin', 'Salbutamol', 'tarragon_curated_brands_v1');

-- ---------------------------------------------------------------------------
-- 2. Interaction and duplication dataset, versioned, with a sign-off gate (8.7, D6)
-- ---------------------------------------------------------------------------
create table public.interaction_dataset_versions (
  version      integer primary key check (version >= 1),
  status       text not null default 'draft' check (status in ('draft', 'approved', 'retired')),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  rule_count   integer not null check (rule_count >= 1),
  summary_doc  text not null,
  signed_by    uuid references public.profiles (id) on delete restrict,
  signed_at    timestamptz,
  sign_note    text,
  created_at   timestamptz not null default now(),
  constraint interaction_dataset_versions_approved_has_signer check (status <> 'approved' or (signed_by is not null and signed_at is not null))
);
comment on table public.interaction_dataset_versions is
  'S53 D6: a version of the interaction and duplication dataset. A version is a draft until the Chief Medical Officer signs it through sign_interaction_dataset(), which recomputes the content hash from the rows. Nothing here is ever seeded as approved.';

create table public.interactions (
  id              uuid primary key default gen_random_uuid(),
  dataset_version integer not null references public.interaction_dataset_versions (version) on delete restrict,
  rule_code       text not null check (rule_code ~ '^[a-z0-9_]+$'),
  kind            text not null check (kind in ('interaction', 'duplicate')),
  drug_a          text not null,
  drug_b          text not null,
  severity        text not null check (severity in ('contraindicated', 'caution', 'info')),
  advice_key      text not null check (advice_key ~ '^medicines\.addcheck\.advice\.'),
  title           text not null,
  source          text not null,
  created_at      timestamptz not null default now(),
  unique (dataset_version, rule_code)
);
comment on table public.interactions is
  'S53 8.7: one row per rule, keyed by therapeutic class (drug_a, drug_b), with the severity, the i18n advice key the patient sees, and the source. The add-a-medicine check in packages/medicines runs the same list; a Jest test fails if this seed and the code differ.';
create index interactions_version_idx on public.interactions (dataset_version);

create or replace function private.interaction_dataset_hash(p_version integer) returns text
language sql stable security definer set search_path = '' as $$
  select encode(extensions.digest(convert_to(coalesce(string_agg(
           rule_code || '|' || kind || '|' || drug_a || '|' || drug_b || '|' || severity || '|' || advice_key || '|' || title || '|' || source,
           E'\n' order by rule_code collate "C"), ''), 'UTF8'), 'sha256'), 'hex')
    from public.interactions where dataset_version = p_version
$$;
revoke all on function private.interaction_dataset_hash(integer) from public, anon, authenticated;

-- An approved version is frozen: rules cannot be added, changed or removed under a signature.
create or replace function private.interaction_dataset_frozen() returns trigger
language plpgsql set search_path = '' as $$
declare v_ver integer;
begin
  v_ver := case when tg_op = 'DELETE' then old.dataset_version else new.dataset_version end;
  if exists (select 1 from public.interaction_dataset_versions where version = v_ver and status <> 'draft') then
    raise exception 'interaction dataset version % is signed or retired and cannot change; create a new version', v_ver using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;
create trigger interactions_frozen before insert or update or delete on public.interactions
  for each row execute function private.interaction_dataset_frozen();

create or replace function private.interaction_dataset_version_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'a dataset version is never deleted' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' and (new.status <> 'draft' or new.signed_by is not null or new.signed_at is not null) then
    raise exception 'a dataset version is created as an unsigned draft' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' then
    if old.status <> 'draft' and (new.status is distinct from old.status and not (old.status = 'approved' and new.status = 'retired')) then
      raise exception 'a signed dataset version only moves to retired' using errcode = '42501';
    end if;
    if new.content_hash is distinct from old.content_hash or new.version is distinct from old.version or new.rule_count is distinct from old.rule_count then
      raise exception 'a dataset version''s hash and size never change' using errcode = '42501';
    end if;
    if new.status = 'approved' and old.status = 'draft' and coalesce(current_setting('tarragon.sign_dataset', true), '') <> 'on' then
      raise exception 'a dataset is approved only through sign_interaction_dataset' using errcode = '42501';
    end if;
  end if;
  return coalesce(new, old);
end $$;
create trigger interaction_dataset_versions_guard before insert or update or delete on public.interaction_dataset_versions
  for each row execute function private.interaction_dataset_version_guard();

alter table public.interaction_dataset_versions enable row level security;
alter table public.interactions enable row level security;
revoke all on public.interaction_dataset_versions, public.interactions from public, anon, authenticated;
-- Signed-in roles may read an APPROVED dataset (the app can show where a warning comes from); drafts are for the CMO and admins.
grant select on public.interaction_dataset_versions, public.interactions to authenticated;
create policy interaction_dataset_versions_read on public.interaction_dataset_versions for select to authenticated
  using (status = 'approved' or private.is_admin() or private.credential_is_cmo());
create policy interactions_read on public.interactions for select to authenticated
  using (exists (select 1 from public.interaction_dataset_versions v
                  where v.version = interactions.dataset_version
                    and (v.status = 'approved' or private.is_admin() or private.credential_is_cmo())));

-- The ONLY door to approval. The Chief Medical Officer passes the hash shown in the sign-off summary; if the rows in the database
-- do not hash to it, nothing is signed. Never called by a migration or a session; a human runs it.
create or replace function public.sign_interaction_dataset(p_version integer, p_content_hash text, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v public.interaction_dataset_versions;
  v_hash text;
begin
  if v_uid is null or not private.credential_is_cmo() then
    raise exception 'only the Chief Medical Officer can sign the interaction dataset' using errcode = '42501';
  end if;
  if nullif(btrim(p_note), '') is null or char_length(btrim(p_note)) < 10 then
    raise exception 'say what was reviewed and by whom (at least 10 characters)' using errcode = '22023';
  end if;
  select * into v from public.interaction_dataset_versions where version = p_version for update;
  if v.version is null then raise exception 'no such dataset version' using errcode = '22023'; end if;
  if v.status <> 'draft' then raise exception 'version % is already %', p_version, v.status using errcode = '22023'; end if;
  v_hash := private.interaction_dataset_hash(p_version);
  if v_hash is distinct from p_content_hash or v_hash is distinct from v.content_hash then
    raise exception 'the dataset in the database does not match the hash you were shown; nothing was signed' using errcode = '22023';
  end if;
  perform set_config('tarragon.sign_dataset', 'on', true);
  update public.interaction_dataset_versions
     set status = 'approved', signed_by = v_uid, signed_at = now(), sign_note = btrim(p_note)
   where version = p_version;
  perform set_config('tarragon.sign_dataset', 'off', true);
  return jsonb_build_object('ok', true, 'version', p_version, 'content_hash', v_hash);
end $$;
revoke all on function public.sign_interaction_dataset(integer, text, text) from public, anon;
grant execute on function public.sign_interaction_dataset(integer, text, text) to authenticated;

-- Version 1: the draft. Rows are generated from docs/clinical/interaction-dataset-v1.seed.json.
insert into public.interaction_dataset_versions (version, status, content_hash, rule_count, summary_doc) values
  (1, 'draft', 'fa9f38ecdfbb970937ba3bfaafb365f2a01f324f57bc4b8ce15a9fb65a296ea5', 85, 'docs/clinical/interaction-dataset-v1.md');
insert into public.interactions (dataset_version, rule_code, kind, drug_a, drug_b, severity, advice_key, title, source) values
  (1, 'ace_inhibitor__arb', 'interaction', 'ace_inhibitor', 'arb', 'contraindicated', 'medicines.addcheck.advice.high', 'Dual blockade of the renin-angiotensin system', 'ONTARGET trial (N Engl J Med 2008;358:1547-59) showed more kidney injury and high potassium with ACE inhibitor plus ARB; BNF Appendix 1. Reviewer to confirm.'),
  (1, 'ace_inhibitor__nsaid', 'interaction', 'ace_inhibitor', 'nsaid', 'caution', 'medicines.addcheck.advice.review', 'Kidney injury risk (NSAID with renin-angiotensin blockade)', 'Standard reference works (BNF Appendix 1 on drug interactions; product labelling such as the SmPC or US prescribing information for the medicines named). Reviewer to confirm the exact entry.'),
  (1, 'ace_inhibitor__potassium_sparing_diuretic', 'interaction', 'ace_inhibitor', 'potassium_sparing_diuretic', 'caution', 'medicines.addcheck.advice.review', 'Hyperkalaemia risk', 'Standard reference works (BNF Appendix 1 on drug interactions; product labelling such as the SmPC or US prescribing information for the medicines named). Reviewer to confirm the exact entry.'),
  (1, 'ace_inhibitor__potassium_supplement', 'interaction', 'ace_inhibitor', 'potassium_supplement', 'caution', 'medicines.addcheck.advice.review', 'Hyperkalaemia risk', 'Standard reference works (BNF Appendix 1 on drug interactions; product labelling such as the SmPC or US prescribing information for the medicines named). Reviewer to confirm the exact entry.'),
  (1, 'allopurinol__colchicine', 'interaction', 'allopurinol', 'colchicine', 'info', 'medicines.addcheck.advice.note', 'Expected combination in gout', 'Standard reference works (BNF Appendix 1 on drug interactions; product labelling such as the SmPC or US prescribing information for the medicines named). Reviewer to confirm the exact entry.'),
  (1, 'amiodarone__fluoroquinolone', 'interaction', 'amiodarone', 'fluoroquinolone', 'caution', 'medicines.addcheck.advice.review', 'Additive QT prolongation', 'Standard reference works (BNF Appendix 1 on drug interactions; product labelling such as the SmPC or US prescribing information for the medicines named). Reviewer to confirm the exact entry.'),
  (1, 'amiodarone__statin', 'interaction', 'amiodarone', 'statin', 'caution', 'medicines.addcheck.advice.review', 'Muscle toxicity risk', 'Standard reference works (BNF Appendix 1 on drug interactions; product labelling such as the SmPC or US prescribing information for the medicines named). Reviewer to confirm the exact entry.'),
  (1, 'anticoagulant__antiplatelet', 'interaction', 'anticoagulant', 'antiplatelet', 'caution', 'medicines.addcheck.advice.review', 'Combined bleeding risk', 'Standard reference works (BNF Appendix 1 on drug interactions; product labelling such as the SmPC or US prescribing information for the medicines named). Reviewer to confirm the exact entry.'),
  (1, 'anticoagulant__azole_antifungal', 'interaction', 'anticoagulant', 'azole_antifungal', 'caution', 'medicines.addcheck.advice.review', 'Anticoagulant effect increased', 'Standard reference works (BNF Appendix 1 on drug interactions; product labelling such as the SmPC or US prescribing information for the medicines named). Reviewer to confirm the exact entry.'),
  (1, 'anticoagulant__fluoroquinolone', 'interaction', 'anticoagulant', 'fluoroquinolone', 'caution', 'medicines.addcheck.advice.review', 'Anticoagulant effect increased', 'Standard reference works (BNF Appendix 1 on drug interactions; product labelling such as the SmPC or US prescribing information for the medicines named). Reviewer to confirm the exact entry.'),
  (1, 'anticoagulant__macrolide', 'interaction', 'anticoagulant', 'macrolide', 'caution', 'medicines.addcheck.advice.review', 'Anticoagulant effect increased', 'Standard reference works (BNF Appendix 1 on drug interactions; product labelling such as the SmPC or US prescribing information for the medicines named). Reviewer to confirm the exact entry.'),
  (1, 'anticoagulant__nitroimidazole', 'interaction', 'anticoagulant', 'nitroimidazole', 'caution', 'medicines.addcheck.advice.review', 'Anticoagulant effect increased', 'Standard reference works (BNF Appendix 1 on drug interactions; product labelling such as the SmPC or US prescribing information for the medicines named). Reviewer to confirm the exact entry.'),
  (1, 'antipsychotic__fluoroquinolone', 'interaction', 'antipsychotic', 'fluoroquinolone', 'caution', 'medicines.addcheck.advice.review', 'Additive QT prolongation', 'Standard reference works (BNF Appendix 1 on drug interactions; product labelling such as the SmPC or US prescribing information for the medicines named). Reviewer to confirm the exact entry.'),
  (1, 'antipsychotic__macrolide', 'interaction', 'antipsychotic', 'macrolide', 'caution', 'medicines.addcheck.advice.review', 'Additive QT prolongation', 'Standard reference works (BNF Appendix 1 on drug interactions; product labelling such as the SmPC or US prescribing information for the medicines named). Reviewer to confirm the exact entry.'),
  (1, 'arb__nsaid', 'interaction', 'arb', 'nsaid', 'caution', 'medicines.addcheck.advice.review', 'Kidney injury risk (NSAID with renin-angiotensin blockade)', 'Standard reference works (BNF Appendix 1 on drug interactions; product labelling such as the SmPC or US prescribing information for the medicines named). Reviewer to confirm the exact entry.'),
  (1, 'arb__potassium_sparing_diuretic', 'interaction', 'arb', 'potassium_sparing_diuretic', 'caution', 'medicines.addcheck.advice.review', 'Hyperkalaemia risk', 'Standard reference works (BNF Appendix 1 on drug interactions; product labelling such as the SmPC or US prescribing information for the medicines named). Reviewer to confirm the exact entry.'),
  (1, 'arb__potassium_supplement', 'interaction', 'arb', 'potassium_supplement', 'caution', 'medicines.addcheck.advice.review', 'Hyperkalaemia risk', 'Standard reference works (BNF Appendix 1 on drug interactions; product labelling such as the SmPC or US prescribing information for the medicines named). Reviewer to confirm the exact entry.'),
  (1, 'beta_blocker__ccb_non_dihydropyridine', 'interaction', 'beta_blocker', 'ccb_non_dihydropyridine', 'contraindicated', 'medicines.addcheck.advice.high', 'Bradycardia and heart block risk', 'Verapamil and diltiazem product labelling (caution with beta blockers); BNF Appendix 1. Reviewer to confirm.'),
  (1, 'digoxin__amiodarone', 'interaction', 'digoxin', 'amiodarone', 'caution', 'medicines.addcheck.advice.review', 'Digoxin toxicity risk', 'Standard reference works (BNF Appendix 1 on drug interactions; product labelling such as the SmPC or US prescribing information for the medicines named). Reviewer to confirm the exact entry.'),
  (1, 'digoxin__ccb_non_dihydropyridine', 'interaction', 'digoxin', 'ccb_non_dihydropyridine', 'caution', 'medicines.addcheck.advice.review', 'Digoxin toxicity risk', 'Standard reference works (BNF Appendix 1 on drug interactions; product labelling such as the SmPC or US prescribing information for the medicines named). Reviewer to confirm the exact entry.'),
  (1, 'digoxin__loop_diuretic', 'interaction', 'digoxin', 'loop_diuretic', 'caution', 'medicines.addcheck.advice.review', 'Digoxin toxicity via low potassium', 'Standard reference works (BNF Appendix 1 on drug interactions; product labelling such as the SmPC or US prescribing information for the medicines named). Reviewer to confirm the exact entry.'),
  (1, 'duplicate__ace_inhibitor', 'duplicate', 'ace_inhibitor', 'ace_inhibitor', 'contraindicated', 'medicines.addcheck.advice.duplicate', 'Two ACE inhibitor medicines at the same time', 'Duplicate-therapy check: two medicines of one class rarely add benefit and often add side effects. Reviewer to confirm.'),
  (1, 'duplicate__allopurinol', 'duplicate', 'allopurinol', 'allopurinol', 'contraindicated', 'medicines.addcheck.advice.duplicate', 'Two Allopurinol medicines at the same time', 'Duplicate-therapy check: two medicines of one class rarely add benefit and often add side effects. Reviewer to confirm.'),
  (1, 'duplicate__aminoglycoside', 'duplicate', 'aminoglycoside', 'aminoglycoside', 'contraindicated', 'medicines.addcheck.advice.duplicate', 'Two Aminoglycoside antibiotic medicines at the same time', 'Duplicate-therapy check: two medicines of one class rarely add benefit and often add side effects. Reviewer to confirm.'),
  (1, 'duplicate__amiodarone', 'duplicate', 'amiodarone', 'amiodarone', 'contraindicated', 'medicines.addcheck.advice.duplicate', 'Two Amiodarone medicines at the same time', 'Duplicate-therapy check: two medicines of one class rarely add benefit and often add side effects. Reviewer to confirm.'),
  (1, 'duplicate__anticoagulant', 'duplicate', 'anticoagulant', 'anticoagulant', 'contraindicated', 'medicines.addcheck.advice.duplicate', 'Two Anticoagulant medicines at the same time', 'Duplicate-therapy check: two medicines of one class rarely add benefit and often add side effects. Reviewer to confirm.'),
  (1, 'duplicate__antimalarial_act', 'duplicate', 'antimalarial_act', 'antimalarial_act', 'contraindicated', 'medicines.addcheck.advice.duplicate', 'Two Artemisinin-based antimalarial medicines at the same time', 'Duplicate-therapy check: two medicines of one class rarely add benefit and often add side effects. Reviewer to confirm.'),
  (1, 'duplicate__antiplatelet', 'duplicate', 'antiplatelet', 'antiplatelet', 'caution', 'medicines.addcheck.advice.duplicate', 'Two Antiplatelet medicines at the same time', 'Duplicate-therapy check. Two of this kind are sometimes deliberate, so a warning is raised only when the prescribers differ. Reviewer to confirm.'),
  (1, 'duplicate__antipsychotic', 'duplicate', 'antipsychotic', 'antipsychotic', 'contraindicated', 'medicines.addcheck.advice.duplicate', 'Two Antipsychotic medicines at the same time', 'Duplicate-therapy check: two medicines of one class rarely add benefit and often add side effects. Reviewer to confirm.'),
  (1, 'duplicate__arb', 'duplicate', 'arb', 'arb', 'contraindicated', 'medicines.addcheck.advice.duplicate', 'Two ARB (angiotensin receptor blocker) medicines at the same time', 'Duplicate-therapy check: two medicines of one class rarely add benefit and often add side effects. Reviewer to confirm.'),
  (1, 'duplicate__azole_antifungal', 'duplicate', 'azole_antifungal', 'azole_antifungal', 'contraindicated', 'medicines.addcheck.advice.duplicate', 'Two Azole antifungal medicines at the same time', 'Duplicate-therapy check: two medicines of one class rarely add benefit and often add side effects. Reviewer to confirm.'),
  (1, 'duplicate__beta_blocker', 'duplicate', 'beta_blocker', 'beta_blocker', 'contraindicated', 'medicines.addcheck.advice.duplicate', 'Two Beta blocker medicines at the same time', 'Duplicate-therapy check: two medicines of one class rarely add benefit and often add side effects. Reviewer to confirm.'),
  (1, 'duplicate__calcium_or_iron_supplement', 'duplicate', 'calcium_or_iron_supplement', 'calcium_or_iron_supplement', 'contraindicated', 'medicines.addcheck.advice.duplicate', 'Two Calcium / iron supplement medicines at the same time', 'Duplicate-therapy check: two medicines of one class rarely add benefit and often add side effects. Reviewer to confirm.'),
  (1, 'duplicate__ccb_dihydropyridine', 'duplicate', 'ccb_dihydropyridine', 'ccb_dihydropyridine', 'contraindicated', 'medicines.addcheck.advice.duplicate', 'Two Calcium channel blocker (dihydropyridine) medicines at the same time', 'Duplicate-therapy check: two medicines of one class rarely add benefit and often add side effects. Reviewer to confirm.'),
  (1, 'duplicate__ccb_non_dihydropyridine', 'duplicate', 'ccb_non_dihydropyridine', 'ccb_non_dihydropyridine', 'contraindicated', 'medicines.addcheck.advice.duplicate', 'Two Calcium channel blocker (rate-limiting) medicines at the same time', 'Duplicate-therapy check: two medicines of one class rarely add benefit and often add side effects. Reviewer to confirm.'),
  (1, 'duplicate__cephalosporin', 'duplicate', 'cephalosporin', 'cephalosporin', 'contraindicated', 'medicines.addcheck.advice.duplicate', 'Two Cephalosporin medicines at the same time', 'Duplicate-therapy check: two medicines of one class rarely add benefit and often add side effects. Reviewer to confirm.'),
  (1, 'duplicate__colchicine', 'duplicate', 'colchicine', 'colchicine', 'contraindicated', 'medicines.addcheck.advice.duplicate', 'Two Colchicine medicines at the same time', 'Duplicate-therapy check: two medicines of one class rarely add benefit and often add side effects. Reviewer to confirm.'),
  (1, 'duplicate__cotrimoxazole', 'duplicate', 'cotrimoxazole', 'cotrimoxazole', 'contraindicated', 'medicines.addcheck.advice.duplicate', 'Two Co-trimoxazole medicines at the same time', 'Duplicate-therapy check: two medicines of one class rarely add benefit and often add side effects. Reviewer to confirm.'),
  (1, 'duplicate__digoxin', 'duplicate', 'digoxin', 'digoxin', 'contraindicated', 'medicines.addcheck.advice.duplicate', 'Two Digoxin medicines at the same time', 'Duplicate-therapy check: two medicines of one class rarely add benefit and often add side effects. Reviewer to confirm.'),
  (1, 'duplicate__dpp4', 'duplicate', 'dpp4', 'dpp4', 'contraindicated', 'medicines.addcheck.advice.duplicate', 'Two DPP-4 inhibitor medicines at the same time', 'Duplicate-therapy check: two medicines of one class rarely add benefit and often add side effects. Reviewer to confirm.'),
  (1, 'duplicate__fibrate', 'duplicate', 'fibrate', 'fibrate', 'contraindicated', 'medicines.addcheck.advice.duplicate', 'Two Fibrate medicines at the same time', 'Duplicate-therapy check: two medicines of one class rarely add benefit and often add side effects. Reviewer to confirm.'),
  (1, 'duplicate__fluoroquinolone', 'duplicate', 'fluoroquinolone', 'fluoroquinolone', 'contraindicated', 'medicines.addcheck.advice.duplicate', 'Two Fluoroquinolone antibiotic medicines at the same time', 'Duplicate-therapy check: two medicines of one class rarely add benefit and often add side effects. Reviewer to confirm.'),
  (1, 'duplicate__gabapentinoid', 'duplicate', 'gabapentinoid', 'gabapentinoid', 'contraindicated', 'medicines.addcheck.advice.duplicate', 'Two Gabapentin / pregabalin medicines at the same time', 'Duplicate-therapy check: two medicines of one class rarely add benefit and often add side effects. Reviewer to confirm.'),
  (1, 'duplicate__insulin', 'duplicate', 'insulin', 'insulin', 'caution', 'medicines.addcheck.advice.duplicate', 'Two Insulin medicines at the same time', 'Duplicate-therapy check. Two of this kind are sometimes deliberate, so a warning is raised only when the prescribers differ. Reviewer to confirm.'),
  (1, 'duplicate__levothyroxine', 'duplicate', 'levothyroxine', 'levothyroxine', 'contraindicated', 'medicines.addcheck.advice.duplicate', 'Two Levothyroxine medicines at the same time', 'Duplicate-therapy check: two medicines of one class rarely add benefit and often add side effects. Reviewer to confirm.'),
  (1, 'duplicate__lithium', 'duplicate', 'lithium', 'lithium', 'contraindicated', 'medicines.addcheck.advice.duplicate', 'Two Lithium medicines at the same time', 'Duplicate-therapy check: two medicines of one class rarely add benefit and often add side effects. Reviewer to confirm.'),
  (1, 'duplicate__loop_diuretic', 'duplicate', 'loop_diuretic', 'loop_diuretic', 'contraindicated', 'medicines.addcheck.advice.duplicate', 'Two Loop diuretic medicines at the same time', 'Duplicate-therapy check: two medicines of one class rarely add benefit and often add side effects. Reviewer to confirm.'),
  (1, 'duplicate__macrolide', 'duplicate', 'macrolide', 'macrolide', 'contraindicated', 'medicines.addcheck.advice.duplicate', 'Two Macrolide antibiotic medicines at the same time', 'Duplicate-therapy check: two medicines of one class rarely add benefit and often add side effects. Reviewer to confirm.'),
  (1, 'duplicate__metformin', 'duplicate', 'metformin', 'metformin', 'contraindicated', 'medicines.addcheck.advice.duplicate', 'Two Metformin medicines at the same time', 'Duplicate-therapy check: two medicines of one class rarely add benefit and often add side effects. Reviewer to confirm.'),
  (1, 'duplicate__methotrexate', 'duplicate', 'methotrexate', 'methotrexate', 'contraindicated', 'medicines.addcheck.advice.duplicate', 'Two Methotrexate medicines at the same time', 'Duplicate-therapy check: two medicines of one class rarely add benefit and often add side effects. Reviewer to confirm.'),
  (1, 'duplicate__nitrofurantoin', 'duplicate', 'nitrofurantoin', 'nitrofurantoin', 'contraindicated', 'medicines.addcheck.advice.duplicate', 'Two Nitrofurantoin medicines at the same time', 'Duplicate-therapy check: two medicines of one class rarely add benefit and often add side effects. Reviewer to confirm.'),
  (1, 'duplicate__nitroimidazole', 'duplicate', 'nitroimidazole', 'nitroimidazole', 'contraindicated', 'medicines.addcheck.advice.duplicate', 'Two Metronidazole / tinidazole medicines at the same time', 'Duplicate-therapy check: two medicines of one class rarely add benefit and often add side effects. Reviewer to confirm.'),
  (1, 'duplicate__nsaid', 'duplicate', 'nsaid', 'nsaid', 'contraindicated', 'medicines.addcheck.advice.duplicate', 'Two NSAID medicines at the same time', 'Duplicate-therapy check: two medicines of one class rarely add benefit and often add side effects. Reviewer to confirm.'),
  (1, 'duplicate__penicillin', 'duplicate', 'penicillin', 'penicillin', 'contraindicated', 'medicines.addcheck.advice.duplicate', 'Two Penicillin medicines at the same time', 'Duplicate-therapy check: two medicines of one class rarely add benefit and often add side effects. Reviewer to confirm.'),
  (1, 'duplicate__potassium_sparing_diuretic', 'duplicate', 'potassium_sparing_diuretic', 'potassium_sparing_diuretic', 'contraindicated', 'medicines.addcheck.advice.duplicate', 'Two Potassium-sparing diuretic medicines at the same time', 'Duplicate-therapy check: two medicines of one class rarely add benefit and often add side effects. Reviewer to confirm.'),
  (1, 'duplicate__potassium_supplement', 'duplicate', 'potassium_supplement', 'potassium_supplement', 'contraindicated', 'medicines.addcheck.advice.duplicate', 'Two Potassium supplement medicines at the same time', 'Duplicate-therapy check: two medicines of one class rarely add benefit and often add side effects. Reviewer to confirm.'),
  (1, 'duplicate__ppi', 'duplicate', 'ppi', 'ppi', 'contraindicated', 'medicines.addcheck.advice.duplicate', 'Two Proton pump inhibitor medicines at the same time', 'Duplicate-therapy check: two medicines of one class rarely add benefit and often add side effects. Reviewer to confirm.'),
  (1, 'duplicate__sglt2', 'duplicate', 'sglt2', 'sglt2', 'contraindicated', 'medicines.addcheck.advice.duplicate', 'Two SGLT2 inhibitor medicines at the same time', 'Duplicate-therapy check: two medicines of one class rarely add benefit and often add side effects. Reviewer to confirm.'),
  (1, 'duplicate__ssri', 'duplicate', 'ssri', 'ssri', 'contraindicated', 'medicines.addcheck.advice.duplicate', 'Two SSRI antidepressant medicines at the same time', 'Duplicate-therapy check: two medicines of one class rarely add benefit and often add side effects. Reviewer to confirm.'),
  (1, 'duplicate__statin', 'duplicate', 'statin', 'statin', 'contraindicated', 'medicines.addcheck.advice.duplicate', 'Two Statin medicines at the same time', 'Duplicate-therapy check: two medicines of one class rarely add benefit and often add side effects. Reviewer to confirm.'),
  (1, 'duplicate__sulfonylurea', 'duplicate', 'sulfonylurea', 'sulfonylurea', 'contraindicated', 'medicines.addcheck.advice.duplicate', 'Two Sulfonylurea medicines at the same time', 'Duplicate-therapy check: two medicines of one class rarely add benefit and often add side effects. Reviewer to confirm.'),
  (1, 'duplicate__thiazide_diuretic', 'duplicate', 'thiazide_diuretic', 'thiazide_diuretic', 'contraindicated', 'medicines.addcheck.advice.duplicate', 'Two Thiazide diuretic medicines at the same time', 'Duplicate-therapy check: two medicines of one class rarely add benefit and often add side effects. Reviewer to confirm.'),
  (1, 'duplicate__tramadol_opioid', 'duplicate', 'tramadol_opioid', 'tramadol_opioid', 'contraindicated', 'medicines.addcheck.advice.duplicate', 'Two Tramadol / opioid medicines at the same time', 'Duplicate-therapy check: two medicines of one class rarely add benefit and often add side effects. Reviewer to confirm.'),
  (1, 'fluoroquinolone__antimalarial_act', 'interaction', 'fluoroquinolone', 'antimalarial_act', 'caution', 'medicines.addcheck.advice.review', 'Additive QT prolongation', 'Standard reference works (BNF Appendix 1 on drug interactions; product labelling such as the SmPC or US prescribing information for the medicines named). Reviewer to confirm the exact entry.'),
  (1, 'levothyroxine__calcium_or_iron_supplement', 'interaction', 'levothyroxine', 'calcium_or_iron_supplement', 'caution', 'medicines.addcheck.advice.review', 'Reduced levothyroxine absorption', 'Standard reference works (BNF Appendix 1 on drug interactions; product labelling such as the SmPC or US prescribing information for the medicines named). Reviewer to confirm the exact entry.'),
  (1, 'levothyroxine__ppi', 'interaction', 'levothyroxine', 'ppi', 'info', 'medicines.addcheck.advice.note', 'Levothyroxine absorption may fall', 'Standard reference works (BNF Appendix 1 on drug interactions; product labelling such as the SmPC or US prescribing information for the medicines named). Reviewer to confirm the exact entry.'),
  (1, 'lithium__ace_inhibitor', 'interaction', 'lithium', 'ace_inhibitor', 'caution', 'medicines.addcheck.advice.review', 'Lithium toxicity risk', 'Standard reference works (BNF Appendix 1 on drug interactions; product labelling such as the SmPC or US prescribing information for the medicines named). Reviewer to confirm the exact entry.'),
  (1, 'lithium__nsaid', 'interaction', 'lithium', 'nsaid', 'contraindicated', 'medicines.addcheck.advice.high', 'Lithium toxicity risk', 'Standard reference works (BNF Appendix 1 on drug interactions; product labelling such as the SmPC or US prescribing information for the medicines named). Reviewer to confirm the exact entry.'),
  (1, 'lithium__thiazide_diuretic', 'interaction', 'lithium', 'thiazide_diuretic', 'caution', 'medicines.addcheck.advice.review', 'Lithium toxicity risk', 'Standard reference works (BNF Appendix 1 on drug interactions; product labelling such as the SmPC or US prescribing information for the medicines named). Reviewer to confirm the exact entry.'),
  (1, 'macrolide__antimalarial_act', 'interaction', 'macrolide', 'antimalarial_act', 'caution', 'medicines.addcheck.advice.review', 'Additive QT prolongation', 'Standard reference works (BNF Appendix 1 on drug interactions; product labelling such as the SmPC or US prescribing information for the medicines named). Reviewer to confirm the exact entry.'),
  (1, 'macrolide__fluoroquinolone', 'interaction', 'macrolide', 'fluoroquinolone', 'caution', 'medicines.addcheck.advice.review', 'Additive QT prolongation', 'Standard reference works (BNF Appendix 1 on drug interactions; product labelling such as the SmPC or US prescribing information for the medicines named). Reviewer to confirm the exact entry.'),
  (1, 'methotrexate__cotrimoxazole', 'interaction', 'methotrexate', 'cotrimoxazole', 'contraindicated', 'medicines.addcheck.advice.high', 'Methotrexate toxicity risk', 'Standard reference works (BNF Appendix 1 on drug interactions; product labelling such as the SmPC or US prescribing information for the medicines named). Reviewer to confirm the exact entry.'),
  (1, 'methotrexate__nsaid', 'interaction', 'methotrexate', 'nsaid', 'contraindicated', 'medicines.addcheck.advice.high', 'Methotrexate toxicity risk', 'Standard reference works (BNF Appendix 1 on drug interactions; product labelling such as the SmPC or US prescribing information for the medicines named). Reviewer to confirm the exact entry.'),
  (1, 'nsaid__anticoagulant', 'interaction', 'nsaid', 'anticoagulant', 'contraindicated', 'medicines.addcheck.advice.high', 'Serious bleeding risk', 'BNF Appendix 1 (NSAIDs with anticoagulants); warfarin and DOAC labelling. Reviewer to confirm.'),
  (1, 'nsaid__antiplatelet', 'interaction', 'nsaid', 'antiplatelet', 'caution', 'medicines.addcheck.advice.review', 'Gastrointestinal bleeding risk', 'Standard reference works (BNF Appendix 1 on drug interactions; product labelling such as the SmPC or US prescribing information for the medicines named). Reviewer to confirm the exact entry.'),
  (1, 'nsaid__loop_diuretic', 'interaction', 'nsaid', 'loop_diuretic', 'caution', 'medicines.addcheck.advice.review', 'Reduced diuretic effect and kidney injury risk', 'Standard reference works (BNF Appendix 1 on drug interactions; product labelling such as the SmPC or US prescribing information for the medicines named). Reviewer to confirm the exact entry.'),
  (1, 'ssri__anticoagulant', 'interaction', 'ssri', 'anticoagulant', 'caution', 'medicines.addcheck.advice.review', 'Bleeding risk', 'Standard reference works (BNF Appendix 1 on drug interactions; product labelling such as the SmPC or US prescribing information for the medicines named). Reviewer to confirm the exact entry.'),
  (1, 'ssri__nsaid', 'interaction', 'ssri', 'nsaid', 'caution', 'medicines.addcheck.advice.review', 'Gastrointestinal bleeding risk', 'Standard reference works (BNF Appendix 1 on drug interactions; product labelling such as the SmPC or US prescribing information for the medicines named). Reviewer to confirm the exact entry.'),
  (1, 'ssri__tramadol_opioid', 'interaction', 'ssri', 'tramadol_opioid', 'caution', 'medicines.addcheck.advice.review', 'Serotonin syndrome and seizure risk', 'Standard reference works (BNF Appendix 1 on drug interactions; product labelling such as the SmPC or US prescribing information for the medicines named). Reviewer to confirm the exact entry.'),
  (1, 'statin__azole_antifungal', 'interaction', 'statin', 'azole_antifungal', 'caution', 'medicines.addcheck.advice.review', 'Muscle toxicity risk (statin with azole antifungal)', 'Standard reference works (BNF Appendix 1 on drug interactions; product labelling such as the SmPC or US prescribing information for the medicines named). Reviewer to confirm the exact entry.'),
  (1, 'statin__fibrate', 'interaction', 'statin', 'fibrate', 'caution', 'medicines.addcheck.advice.review', 'Muscle toxicity risk (statin with fibrate)', 'Standard reference works (BNF Appendix 1 on drug interactions; product labelling such as the SmPC or US prescribing information for the medicines named). Reviewer to confirm the exact entry.'),
  (1, 'statin__macrolide', 'interaction', 'statin', 'macrolide', 'contraindicated', 'medicines.addcheck.advice.high', 'Muscle toxicity risk (statin with macrolide)', 'Simvastatin and atorvastatin labelling and MHRA drug safety advice on clarithromycin and erythromycin with statins; BNF Appendix 1. Reviewer to confirm.'),
  (1, 'sulfonylurea__azole_antifungal', 'interaction', 'sulfonylurea', 'azole_antifungal', 'caution', 'medicines.addcheck.advice.review', 'Hypoglycaemia risk', 'Standard reference works (BNF Appendix 1 on drug interactions; product labelling such as the SmPC or US prescribing information for the medicines named). Reviewer to confirm the exact entry.'),
  (1, 'sulfonylurea__cotrimoxazole', 'interaction', 'sulfonylurea', 'cotrimoxazole', 'caution', 'medicines.addcheck.advice.review', 'Hypoglycaemia risk', 'Standard reference works (BNF Appendix 1 on drug interactions; product labelling such as the SmPC or US prescribing information for the medicines named). Reviewer to confirm the exact entry.'),
  (1, 'sulfonylurea__fluoroquinolone', 'interaction', 'sulfonylurea', 'fluoroquinolone', 'caution', 'medicines.addcheck.advice.review', 'Glucose instability', 'Standard reference works (BNF Appendix 1 on drug interactions; product labelling such as the SmPC or US prescribing information for the medicines named). Reviewer to confirm the exact entry.');

-- ---------------------------------------------------------------------------
-- 3. The go-live guard (INV-14). OFF. Its conditions: a signed dataset exists, and a pharmacist's review is attested.
-- ---------------------------------------------------------------------------
insert into public.go_live_guards (key, label, blocks, condition_text, switch_role, enforced_in, not_enforced_in) values
  ('interaction_check_enabled', 'Interaction and duplication check', 'The warning shown when a medicine is added',
   'A signed interaction dataset exists and a pharmacist review of it is recorded', 'cmo',
   array['add-a-medicine form (web and phone) read public.go_live_guard_is_open before running the check'],
   'The clinician medication safety panel and the medicines list warnings that existed before S53 are not behind this guard.')
on conflict (key) do nothing;

-- Add this guard's conditions to private.go_live_conditions without restating the whole live body (other sessions add guards to
-- the same function; this edits whatever definition is current instead of overwriting it).
do $$
declare
  v_def text;
  v_new text;
  v_anchor text := E'  end if;\n  -- An unknown key has no conditions';
  v_branch text := $b$  elsif p_key = 'interaction_check_enabled' then
    return jsonb_build_array(
      private.go_live_cond('interaction_dataset_signed', 'A signed interaction dataset exists',
        exists (select 1 from public.interaction_dataset_versions where status = 'approved'), 'data',
        (select count(*) from public.interaction_dataset_versions where status = 'approved') || ' signed'),
      private.go_live_cond('pharmacist_review_recorded', 'A pharmacist review of the dataset is recorded',
        private.go_live_attested(p_key, 'pharmacist_review_recorded'), 'attestation', null));
$b$;
begin
  v_def := pg_get_functiondef('private.go_live_conditions(text,uuid)'::regprocedure);
  if v_def like '%interaction_check_enabled%' then return; end if;
  if position(v_anchor in v_def) = 0 then
    raise exception 'go_live_conditions has no recognisable end; add the interaction_check_enabled branch by hand';
  end if;
  v_new := replace(v_def, v_anchor, v_branch || v_anchor);
  execute v_new;
end $$;

-- The conditions a person may attest are a fixed list inside attest_go_live_condition; add this guard's one, again by editing the
-- current definition in place (the list grows as sessions add guards; this keeps theirs).
do $$
declare
  v_def text;
  v_anchor text := $a$('public_signup_enabled', 'stage2_exit_criteria_met')$a$;
begin
  v_def := pg_get_functiondef('public.attest_go_live_condition(text,text,boolean,text)'::regprocedure);
  if v_def like '%pharmacist_review_recorded%' then return; end if;
  if position(v_anchor in v_def) = 0 then
    raise exception 'attest_go_live_condition has no recognisable list; add (interaction_check_enabled, pharmacist_review_recorded) by hand';
  end if;
  execute replace(v_def, v_anchor, v_anchor || E',\n       (''interaction_check_enabled'', ''pharmacist_review_recorded'')');
end $$;

-- ---------------------------------------------------------------------------
-- 4. Side-effect notes, carried to the next consultation (8.7)
-- ---------------------------------------------------------------------------
create table public.medication_side_effect_notes (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  patient_id      uuid not null references public.profiles (id) on delete cascade,
  medication_id   uuid not null references public.medications (id) on delete restrict,
  note            text not null check (char_length(btrim(note)) between 1 and 500),
  noted_at        timestamptz not null default now(),
  source          text not null default 'patient' check (source in ('patient', 'guardian')),
  recorded_by     uuid not null references public.profiles (id) on delete restrict,
  reviewed_at     timestamptz,
  reviewed_by     uuid references public.profiles (id) on delete restrict,
  is_test         boolean not null default false,
  constraint medication_side_effect_notes_review_pair check ((reviewed_at is null) = (reviewed_by is null))
);
comment on table public.medication_side_effect_notes is
  'S53 8.7: what a person noticed after a medicine, in their own words, so the next consultation starts from it. The patient and an acting guardian write and read their own; staff read through care_team_side_effect_notes (audited, INV-10). A note never changes a medicine, a dose or a schedule.';
create index medication_side_effect_notes_patient_idx on public.medication_side_effect_notes (patient_id, noted_at desc);
create index medication_side_effect_notes_med_idx on public.medication_side_effect_notes (medication_id);

-- Forbids UPDATE for everyone; the review stamp needs one narrow exception, set only inside mark_side_effect_notes_reviewed().
create or replace function private.medication_side_effect_note_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v record;
begin
  if tg_op = 'UPDATE' then
    if coalesce(current_setting('tarragon.note_review', true), '') = 'on'
       and new.note is not distinct from old.note and new.patient_id is not distinct from old.patient_id
       and new.medication_id is not distinct from old.medication_id and new.noted_at is not distinct from old.noted_at then
      return new;
    end if;
    raise exception 'a side-effect note is never edited; add a new one' using errcode = '42501';
  end if;
  select patient_id, organisation_id into v from public.medications where id = new.medication_id;
  if not found then raise exception 'medication not found' using errcode = '23503'; end if;
  new.patient_id := v.patient_id;
  new.organisation_id := v.organisation_id;
  new.recorded_by := (select auth.uid());
  new.source := case when (select auth.uid()) = v.patient_id then 'patient' else 'guardian' end;
  new.noted_at := now();
  new.reviewed_at := null;
  new.reviewed_by := null;
  new.is_test := coalesce((select pr.is_test from public.profiles pr where pr.id = v.patient_id), false);
  return new;
end $$;

create trigger medication_side_effect_notes_guard before insert or update on public.medication_side_effect_notes
  for each row execute function private.medication_side_effect_note_guard();

alter table public.medication_side_effect_notes enable row level security;
revoke all on public.medication_side_effect_notes from public, anon, authenticated;
grant select, insert on public.medication_side_effect_notes to authenticated;
-- Same read rule as the medications table itself (category-scoped, clinical-access aware): a helper with only a booking or payments
-- grant can read neither the medicines nor the notes about them.
create policy medication_side_effect_notes_select on public.medication_side_effect_notes for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.can_read_clinical(patient_id, 'medications'::public.care_access_category)
    or private.can_read_clinical(patient_id, 'view_medication'::public.caregiver_permission)
  );
create policy medication_side_effect_notes_insert on public.medication_side_effect_notes for insert to authenticated
  with check (
    exists (select 1 from public.medications m where m.id = medication_id
             and (m.patient_id = (select auth.uid()) or private.can_act_for(m.patient_id, 'view_medication'::public.caregiver_permission)))
  );

-- Staff read: only the care team the patient is tied to, with a reason, every read audited.
create or replace function public.care_team_side_effect_notes(p_patient uuid, p_reason text)
returns table (note_id uuid, medication_id uuid, drug_name text, note text, noted_at timestamptz, reviewed_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise exception 'not authorised' using errcode = '42501'; end if;
  if p_reason is null or char_length(btrim(p_reason)) < 10 then
    raise exception 'a reason of at least 10 characters is required' using errcode = '22023';
  end if;
  if exists (select 1 from public.profiles where id = (select auth.uid()) and role = 'patient') then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  if not private.can_staff_read_clinical(p_patient, 'medications'::public.care_access_category) then
    perform private.audit_chart_read(p_patient, array['side_effect_notes'], p_reason, 'denied');
    return;
  end if;
  perform private.audit_chart_read(p_patient, array['side_effect_notes'], p_reason, 'success');
  return query
    select n.id, n.medication_id, m.drug_name, n.note, n.noted_at, n.reviewed_at
      from public.medication_side_effect_notes n
      join public.medications m on m.id = n.medication_id
     where n.patient_id = p_patient
     order by n.noted_at desc
     limit 100;
end $$;
revoke all on function public.care_team_side_effect_notes(uuid, text) from public, anon;
grant execute on function public.care_team_side_effect_notes(uuid, text) to authenticated;

create or replace function public.mark_side_effect_notes_reviewed(p_patient uuid, p_note_ids uuid[], p_reason text)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_n integer;
begin
  if (select auth.uid()) is null then raise exception 'not authorised' using errcode = '42501'; end if;
  if p_reason is null or char_length(btrim(p_reason)) < 10 then
    raise exception 'a reason of at least 10 characters is required' using errcode = '22023';
  end if;
  if p_note_ids is null or cardinality(p_note_ids) = 0 then return 0; end if;
  if exists (select 1 from public.profiles where id = (select auth.uid()) and role = 'patient')
     or not private.can_staff_read_clinical(p_patient, 'medications'::public.care_access_category) then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  perform set_config('tarragon.note_review', 'on', true);
  -- only the notes the clinician was shown (by id), and only this patient's: a note written after the read is not marked
  update public.medication_side_effect_notes
     set reviewed_at = now(), reviewed_by = (select auth.uid())
   where patient_id = p_patient and reviewed_at is null and id = any (p_note_ids);
  get diagnostics v_n = row_count;
  perform set_config('tarragon.note_review', 'off', true);
  perform private.audit_chart_read(p_patient, array['side_effect_notes'], p_reason, 'success');
  return v_n;
end $$;
revoke all on function public.mark_side_effect_notes_reviewed(uuid, uuid[], text) from public, anon;
grant execute on function public.mark_side_effect_notes_reviewed(uuid, uuid[], text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. A neutral in-app notice to a consented supporter when a dose is missed (8.4, 8.6). Medfriend-style, in app only.
--    Consent is the patient's own existing profile_access grant: clinical_access, with view_medication AND receive_alerts named
--    explicitly in permissions (a grant with no permission list is NOT treated as consent to this new notice).
--    One notice per supporter per Lagos day. Generic wording (INV-07): it names no medicine, condition or reading.
--    A failure here never blocks the dose log, and nothing depends on the notice being sent.
-- ---------------------------------------------------------------------------
create table public.supporter_missed_dose_notices (
  profile_access_id uuid not null references public.profile_access (id) on delete cascade,
  notice_date       date not null,
  created_at        timestamptz not null default now(),
  primary key (profile_access_id, notice_date)
);
comment on table public.supporter_missed_dose_notices is
  'S53: dedupe ledger so a supporter hears about missed doses at most once a day. Deleted with the grant.';
alter table public.supporter_missed_dose_notices enable row level security;
revoke all on public.supporter_missed_dose_notices from public, anon, authenticated;

insert into public.notification_templates (key, category, business_priority, audience, default_channels, timing, description) values
  ('supporter_missed_dose_notice', 'administrative', 'routine', 'patient', array['in_app']::public.notification_channel[], 'immediate',
   'S53: a person you support has a care plan check with no record yet. In app only. Names no medicine, condition or reading (INV-07).')
on conflict (key) do nothing;
insert into public.notification_template_locales (template_key, locale, channel, subject, body) values
  ('supporter_missed_dose_notice', 'en', 'in_app', 'A check-in with no record',
   'Someone you support has a care plan check with no record yet. You may want to call them.')
on conflict (template_key, locale, channel) do nothing;

create or replace function private.notify_supporters_of_missed_dose() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  v_day date := (now() at time zone 'Africa/Lagos')::date;
  v_inserted integer;
begin
  -- a row synced late for an old slot (a phone that was offline) is history, not news: no notice
  if new.scheduled_for_date is not null and new.scheduled_for_date < v_day - 1 then return null; end if;
  begin
    -- the ledger only needs a few days; prune this patient's old rows as we go so it never grows without bound
    delete from public.supporter_missed_dose_notices n
     using public.profile_access g
     where n.profile_access_id = g.id and g.profile_id = new.patient_id and n.notice_date < v_day - 7;
    for r in
      select pa.id as grant_id, pa.grantee_user_id, pr.organisation_id
        from public.profile_access pa
        join public.profiles pr on pr.id = pa.profile_id
       where pa.profile_id = new.patient_id
         and pa.clinical_access
         and (pa.expires_at is null or pa.expires_at > now())
         and pa.permissions is not null
         and 'view_medication'::public.caregiver_permission = any (pa.permissions)
         and 'receive_alerts'::public.caregiver_permission = any (pa.permissions)
    loop
      insert into public.supporter_missed_dose_notices (profile_access_id, notice_date)
      values (r.grant_id, v_day) on conflict do nothing;
      get diagnostics v_inserted = row_count;
      if v_inserted = 1 then
        insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
        values (r.organisation_id, r.grantee_user_id, 'in_app', 'pending', 'supporter_missed_dose_notice',
                jsonb_build_object('patient_profile_id', new.patient_id));
      end if;
    end loop;
  exception when others then
    raise warning 'supporter missed-dose notice not written for patient %: %', new.patient_id, sqlerrm;
  end;
  return null;
end $$;
revoke all on function private.notify_supporters_of_missed_dose() from public, anon, authenticated;
create trigger medication_logs_notify_supporters after insert on public.medication_logs
  for each row when (new.status = 'missed') execute function private.notify_supporters_of_missed_dose();

-- ---------------------------------------------------------------------------
-- 6. Assertions
-- ---------------------------------------------------------------------------
do $$
declare
  v_n integer;
begin
  if (select count(*) from public.medicine_catalogue where nafdac_number is not null or is_verified) <> 0 then
    raise exception 'FAIL: a catalogue row was seeded with a NAFDAC number or marked verified';
  end if;
  if (select count(*) from public.medicine_catalogue) < 60 then raise exception 'FAIL: catalogue seed missing'; end if;
  if exists (select 1 from public.interaction_dataset_versions where status <> 'draft' or signed_by is not null) then
    raise exception 'FAIL: a dataset version was seeded signed';
  end if;
  select count(*) into v_n from public.interactions where dataset_version = 1;
  if v_n < 50 then raise exception 'FAIL: dataset v1 rows missing (%)', v_n; end if;
  if private.interaction_dataset_hash(1) is distinct from (select content_hash from public.interaction_dataset_versions where version = 1) then
    raise exception 'FAIL: dataset v1 does not hash to the recorded content_hash';
  end if;
  if (select is_on from public.go_live_guards where key = 'interaction_check_enabled') is distinct from false then
    raise exception 'FAIL: interaction_check_enabled must be off';
  end if;
  if has_function_privilege('anon', 'public.sign_interaction_dataset(integer,text,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.care_team_side_effect_notes(uuid,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.mark_side_effect_notes_reviewed(uuid,uuid[],text)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute an S53 function';
  end if;
  if has_table_privilege('anon', 'public.medicine_catalogue', 'SELECT') or has_table_privilege('anon', 'public.interactions', 'SELECT')
     or has_table_privilege('anon', 'public.medication_side_effect_notes', 'SELECT') then
    raise exception 'FAIL: anon can read an S53 table';
  end if;
  if not exists (select 1 from jsonb_array_elements(private.go_live_conditions('interaction_check_enabled', null)) c where c ->> 'code' = 'interaction_dataset_signed') then
    raise exception 'FAIL: the interaction_check_enabled conditions were not added';
  end if;
  raise notice 'PASS: S53 catalogue, dataset v1 (draft, % rules), guard off, notes and supporter notice in place', v_n;
end $$;
