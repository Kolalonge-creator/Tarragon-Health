-- S08y (medicines safety gaps): same-ingredient check twin, governed interaction rules, brand-to-generic map, the NAFDAC number
-- note, and the supporter's "today's doses" view. EVERYTHING HERE IS BORN OFF AND UNSIGNED. Nothing is applied to a person
-- until a human signs or switches it. Additive and idempotent-safe: every object is new, nothing is dropped or rewritten except
-- one in-place addition to private.go_live_conditions (the documented anchor).
--
-- What this does:
--   1. private.split_ingredients / private.duplicate_ingredient_pairs: the SQL twin of packages/medicines `findDuplicateIngredients`
--      (order independent; both run the cases in ingredients.fixtures.ts). Used by the proof; no table, no side effect.
--   2. medicine_interaction_rule_sets: governed, versioned, CMO-signed interaction rules, following the S08x prn_limit_rules pattern
--      exactly. Born EMPTY (v1 is {"rules": []}), unsigned and inactive. NO clinical rule is seeded. Only the active Chief Medical
--      Officer can sign (public.sign_medicine_interaction_rule_sets, which refuses an empty set); a signed version older than a
--      newer signed one cannot be re-activated. private.interaction_rules_valid is the SQL twin of validateRuleSet.
--      WARN ONLY: no function here can stop, edit or remove a medicine. No model is used (INV-01).
--   3. medicine_brand_generic_map: brand name to active ingredients, with a public citation for every row and a publish gate
--      (a named doctor as reviewer, who is not the person who entered or last changed it). Born EMPTY, nothing seeded. Writes only through audited functions.
--   4. medication_pack_numbers: the NAFDAC number a person copies from a pack, stored as a note beside the medicine. Store only:
--      no outbound call, no claim about authenticity. The prescribed `medications` row is never touched (INV-02).
--   5. public.supporter_todays_doses: read-only "was today's dose taken" for a person who granted the `medications` category
--      (profile_access_categories), never wider; refuses everyone else. Every successful read is audited.
--   6. Three go-live guards, all OFF: medicine_duplicate_ingredient_check, medicine_interaction_rules, supporter_todays_doses.
--
-- Live row counts read 2026-10-20: medications 4; no brand map, rule set or pack number table existed; go_live_guards 56 rows.
-- A reference table (brand map, rule sets) carries no organisation_id or patient_id, like medicine_catalogue and prn_limit_rules.

-- 1. The same-ingredient twin ---------------------------------------------------------------------------------------------
create or replace function private.split_ingredients(p_generic text) returns text[]
language sql immutable set search_path = '' as $$
  select coalesce(array_agg(distinct p collate "C" order by p collate "C"), '{}'::text[])
    from (
      select private.normalise_term(regexp_replace(x,
               '\m\d+([.,]\d+)?\s*(mg|mcg|ug|g|ml|iu|units?)\M|\m(tablets?|tabs?|capsules?|caps?|syrup|suspension|injection|cream|ointment|drops)\M',
               ' ', 'g')) as p
        from regexp_split_to_table(lower(coalesce(p_generic, '')), '\s*(?:\mand\M|\mwith\M|/|\+|,|&|;)\s*') x
    ) s
   where p is not null
$$;

-- p_items: [{"id": "...", "generic": "..."}]. Every pair of different ids that share an ingredient, a before b in code-unit order.
create or replace function private.duplicate_ingredient_pairs(p_items jsonb)
returns table (a text, b text, shared text[])
language sql immutable set search_path = '' as $$
  with it as (
    select e ->> 'id' as id, private.split_ingredients(e ->> 'generic') as ing
      from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) e
  )
  select x.id, y.id,
         array(select i from unnest(x.ing) i where i = any (y.ing) order by i collate "C")
    from it x join it y on x.id collate "C" < y.id collate "C"
   where x.ing && y.ing
   order by x.id collate "C", y.id collate "C"
$$;

-- 2. Governed interaction rules ---------------------------------------------------------------------------------------------
create or replace function private.interaction_rule_ok(r jsonb) returns boolean
language sql immutable set search_path = '' as $$
  -- coalesce: a missing key makes a comparison NULL, and NULL must read as "not valid", never as "passes"
  select coalesce(
         jsonb_typeof(r) = 'object'
     and jsonb_typeof(r -> 'code') = 'string' and (r ->> 'code') ~ '^[a-z0-9_]{1,60}$'
     and jsonb_typeof(r -> 'ingredientA') = 'string' and jsonb_typeof(r -> 'ingredientB') = 'string'
     and (r ->> 'ingredientA') <> '' and (r ->> 'ingredientA') = coalesce(private.normalise_term(r ->> 'ingredientA'), '')
     and (r ->> 'ingredientB') <> '' and (r ->> 'ingredientB') = coalesce(private.normalise_term(r ->> 'ingredientB'), '')
     and (r ->> 'ingredientA') <> (r ->> 'ingredientB')
     and jsonb_typeof(r -> 'severity') = 'string' and (r ->> 'severity') in ('contraindicated', 'caution', 'info')
     and jsonb_typeof(r -> 'source') = 'string' and char_length(btrim(r ->> 'source')) >= 5 and (r ->> 'source') ~* 'https://\S+', false)
$$;

create or replace function private.interaction_rules_valid(config jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(
         jsonb_typeof(config) = 'object'
     and jsonb_typeof(config -> 'rules') = 'array'
     and jsonb_array_length(config -> 'rules') <= 500
     and not exists (select 1 from jsonb_array_elements(config -> 'rules') r where not private.interaction_rule_ok(r))
     and (select count(*) = count(distinct r ->> 'code') from jsonb_array_elements(config -> 'rules') r), false)
$$;

create table if not exists public.medicine_interaction_rule_sets (
  id          uuid primary key default gen_random_uuid(),
  version     integer not null,
  config      jsonb not null,
  notes       text,
  approved_by uuid references public.clinical_staff (id) on delete restrict,
  approved_at timestamptz,
  is_active   boolean not null default false,
  created_at  timestamptz not null default now(),
  constraint medicine_interaction_rule_sets_version_unique unique (version),
  constraint medicine_interaction_rule_sets_signature_paired check ((approved_by is null) = (approved_at is null)),
  constraint medicine_interaction_rule_sets_active_requires_signature check (not is_active or approved_by is not null),
  constraint medicine_interaction_rule_sets_config_shape check (private.interaction_rules_valid(config))
);
create unique index if not exists medicine_interaction_rule_sets_one_active on public.medicine_interaction_rule_sets (is_active) where is_active;
comment on table public.medicine_interaction_rule_sets is
  'S08y. Governed, versioned, Chief-Medical-Officer-signed interaction rules (ingredient pairs, severity, public source). Born empty, unsigned and inactive: this repository authors no clinical rule. Warn only; an unsigned draft does nothing and is not readable by patients.';

alter table public.medicine_interaction_rule_sets enable row level security;
-- Staff and admins read the table (drafts included, to review them). A patient reads NOTHING from it directly: the rules reach a patient
-- only through public.active_medicine_interaction_rules(), which honours the go-live guard, so a closed switch cannot be bypassed by a query.
drop policy if exists medicine_interaction_rule_sets_select on public.medicine_interaction_rule_sets;
create policy medicine_interaction_rule_sets_select on public.medicine_interaction_rule_sets for select to authenticated
  using (private.is_admin() or exists (select 1 from public.clinical_staff cs where cs.profile_id = (select auth.uid()) and cs.active));
drop policy if exists medicine_interaction_rule_sets_insert on public.medicine_interaction_rule_sets;
create policy medicine_interaction_rule_sets_insert on public.medicine_interaction_rule_sets for insert to authenticated
  with check (
    (private.is_admin() or exists (
      select 1 from public.clinical_staff cs
       where cs.profile_id = (select auth.uid()) and cs.active and cs.doctor_tier = 'chief_medical_officer'))
    and approved_by is null and approved_at is null and is_active = false);
revoke all on public.medicine_interaction_rule_sets from public, anon, authenticated;
grant select, insert on public.medicine_interaction_rule_sets to authenticated;

insert into public.medicine_interaction_rule_sets (version, config, notes, is_active)
values (1, '{"rules": []}'::jsonb,
        'S08y (2026-10-20). Born empty: no rule is authored by the build. A pharmacist and clinicians write rules with a public source for each; the Chief Medical Officer signs. Nothing is live until then.',
        false)
on conflict (version) do nothing;

create or replace function public.sign_medicine_interaction_rule_sets(p_rules_id uuid)
returns public.medicine_interaction_rule_sets
language plpgsql security definer set search_path = '' as $$
declare
  v_staff uuid;
  v_row   public.medicine_interaction_rule_sets;
begin
  select cs.id into v_staff
    from public.clinical_staff cs
   where cs.profile_id = (select auth.uid()) and cs.active and cs.doctor_tier = 'chief_medical_officer';
  if v_staff is null then
    raise exception 'only the active Chief Medical Officer may sign the interaction rules' using errcode = '42501';
  end if;
  if not exists (select 1 from public.medicine_interaction_rule_sets
                  where id = p_rules_id and jsonb_array_length(config -> 'rules') > 0) then
    raise exception 'an empty or unknown rule set cannot be signed' using errcode = '22023';
  end if;
  update public.medicine_interaction_rule_sets set is_active = false where is_active and id <> p_rules_id;
  update public.medicine_interaction_rule_sets
     set approved_by = v_staff, approved_at = now(), is_active = true
   where id = p_rules_id
   returning * into v_row;
  perform private.log_audit('medicine_interaction_rule_sets.signed', 'medicine_interaction_rule_sets', v_row.id,
    jsonb_build_object('version', v_row.version, 'rules', jsonb_array_length(v_row.config -> 'rules')));
  return v_row;
end $$;
revoke all on function public.sign_medicine_interaction_rule_sets(uuid) from public, anon;
grant execute on function public.sign_medicine_interaction_rule_sets(uuid) to authenticated;

drop trigger if exists refuse_superseded_activation on public.medicine_interaction_rule_sets;
create trigger refuse_superseded_activation before update of is_active on public.medicine_interaction_rule_sets
  for each row when (new.is_active and not old.is_active)
  execute function private.refuse_activating_superseded_version();

-- The rules reach a client only while the guard is open for that person AND a signed, non-empty set is active.
create or replace function public.active_medicine_interaction_rules() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_row public.medicine_interaction_rule_sets;
begin
  if (select auth.uid()) is null then raise exception 'not authorised' using errcode = '42501'; end if;
  if not private.go_live_open_patient('medicine_interaction_rules', (select auth.uid())) then
    return jsonb_build_object('status', 'closed');
  end if;
  select * into v_row from public.medicine_interaction_rule_sets where is_active and approved_by is not null;
  if not found or jsonb_array_length(v_row.config -> 'rules') = 0 then
    return jsonb_build_object('status', 'closed');
  end if;
  return jsonb_build_object('status', 'ok', 'version', v_row.version, 'rules', v_row.config -> 'rules');
end $$;
revoke all on function public.active_medicine_interaction_rules() from public, anon;
grant execute on function public.active_medicine_interaction_rules() to authenticated;

-- 3. Brand to generic map -----------------------------------------------------------------------------------------------------
create or replace function private.ingredient_list_ok(p text[]) returns boolean
language sql immutable set search_path = '' as $$
  select p is not null and cardinality(p) between 1 and 10
     and not exists (select 1 from unnest(p) i where i is null or char_length(btrim(i)) not between 2 and 80)
$$;

create table if not exists public.medicine_brand_generic_map (
  id              uuid primary key default gen_random_uuid(),
  brand_name      text not null check (char_length(btrim(brand_name)) between 1 and 80),
  brand_key       text generated always as (private.normalise_term(brand_name)) stored,
  ingredients     text[] not null check (private.ingredient_list_ok(ingredients)),
  source_citation text not null check (char_length(btrim(source_citation)) between 5 and 400 and source_citation ~* 'https://\S+'),
  created_by      uuid references public.profiles (id) on delete restrict,
  edited_by       uuid references public.profiles (id) on delete restrict,
  edited_at       timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  reviewed_by     uuid references public.profiles (id) on delete restrict,
  reviewer_name   text,
  reviewed_at     timestamptz,
  is_active       boolean not null default false,
  constraint medicine_brand_generic_map_brand_key_unique unique (brand_key),
  constraint medicine_brand_generic_map_review_paired check ((reviewed_by is null) = (reviewed_at is null) and (reviewed_by is null) = (reviewer_name is null)),
  constraint medicine_brand_generic_map_active_requires_review check (not is_active or (reviewed_by is not null and char_length(btrim(reviewer_name)) >= 2)),
  constraint medicine_brand_generic_map_reviewer_not_author check (
    reviewed_by is null or ((created_by is null or reviewed_by <> created_by) and (edited_by is null or reviewed_by <> edited_by)))
);
comment on table public.medicine_brand_generic_map is
  'S08y. Brand name to active ingredients, each row with a public citation. Used for search and the same-ingredient warning only. Born empty. A row is used only when active, with a named reviewer who is not the author; editing a row clears its review.';

create or replace function private.can_edit_brand_map() returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_admin()
      or exists (select 1 from public.clinical_staff cs where cs.profile_id = (select auth.uid()) and cs.active)
$$;
-- A reviewer is a doctor. A Care Coordinator (logistics only, no clinical judgement) may enter a draft but never approves one.
create or replace function private.can_review_brand_map() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.clinical_staff cs
                  where cs.profile_id = (select auth.uid()) and cs.active
                    and cs.doctor_tier in ('senior_medical_officer', 'chief_medical_officer'))
$$;

alter table public.medicine_brand_generic_map enable row level security;
drop policy if exists medicine_brand_generic_map_select on public.medicine_brand_generic_map;
-- Staff read the table. A patient reads published rows only through public.published_medicine_brands(), which hides who entered and reviewed them.
create policy medicine_brand_generic_map_select on public.medicine_brand_generic_map for select to authenticated
  using (private.can_edit_brand_map());
revoke all on public.medicine_brand_generic_map from public, anon, authenticated;
grant select on public.medicine_brand_generic_map to authenticated;

-- Editing what a row says withdraws its review and takes it out of use until a reviewer looks again.
create or replace function private.brand_map_reset_review() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.brand_name is distinct from old.brand_name or new.ingredients is distinct from old.ingredients
     or new.source_citation is distinct from old.source_citation then
    new.reviewed_by := null; new.reviewer_name := null; new.reviewed_at := null; new.is_active := false;
  end if;
  return new;
end $$;
drop trigger if exists medicine_brand_generic_map_reset_review on public.medicine_brand_generic_map;
create trigger medicine_brand_generic_map_reset_review before update on public.medicine_brand_generic_map
  for each row execute function private.brand_map_reset_review();

-- Enter or correct one row (a draft). p_id null: a new row.
create or replace function public.save_medicine_brand_map(p_id uuid, p_brand text, p_ingredients text[], p_citation text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if (select auth.uid()) is null or not private.can_edit_brand_map() then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  if p_id is null then
    insert into public.medicine_brand_generic_map (brand_name, ingredients, source_citation, created_by, edited_by)
    values (btrim(p_brand), p_ingredients, btrim(p_citation), (select auth.uid()), (select auth.uid()))
    returning id into v_id;
  else
    -- edited_by is the LAST person to change what the row says: they may not review it either.
    update public.medicine_brand_generic_map
       set brand_name = btrim(p_brand), ingredients = p_ingredients, source_citation = btrim(p_citation), edited_by = (select auth.uid()), edited_at = clock_timestamp()
     where id = p_id returning id into v_id;
    if v_id is null then raise exception 'brand map row not found' using errcode = '22023'; end if;
  end if;
  perform private.log_audit('medicine_brand_generic_map.saved', 'medicine_brand_generic_map', v_id, '{}'::jsonb);
  return v_id;
end $$;
revoke all on function public.save_medicine_brand_map(uuid, text, text[], text) from public, anon;
grant execute on function public.save_medicine_brand_map(uuid, text, text[], text) to authenticated;

-- CSV importer target: rows arrive already checked by packages/medicines parseBrandMapCsv; the table checks them again.
-- A brand already on file is skipped (never overwritten). Returns the number added.
create or replace function public.import_medicine_brand_map(p_rows jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_n integer;
begin
  if (select auth.uid()) is null or not private.can_edit_brand_map() then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) > 500 then
    raise exception 'rows must be a list of at most 500' using errcode = '22023';
  end if;
  insert into public.medicine_brand_generic_map (brand_name, ingredients, source_citation, created_by, edited_by)
  select btrim(r ->> 'brand_name'),
         array(select jsonb_array_elements_text(r -> 'ingredients')),
         btrim(r ->> 'source_citation'), (select auth.uid()), (select auth.uid())
    from jsonb_array_elements(p_rows) r
  on conflict (brand_key) do nothing;
  get diagnostics v_n = row_count;
  perform private.log_audit('medicine_brand_generic_map.imported', 'medicine_brand_generic_map', null, jsonb_build_object('added', v_n));
  return v_n;
end $$;
revoke all on function public.import_medicine_brand_map(jsonb) from public, anon;
grant execute on function public.import_medicine_brand_map(jsonb) to authenticated;

-- The publish gate. Approve: a named reviewer who did not enter the row. Withdraw: back to a draft.
-- p_seen_edited_at is the row's edited_at as the reviewer saw it. An approval of content that changed since is refused, so a stale page
-- can never put unseen content live under the reviewer's name.
create or replace function public.review_medicine_brand_map(p_id uuid, p_approve boolean, p_seen_edited_at timestamptz default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_name text;
  m      public.medicine_brand_generic_map;
begin
  if (select auth.uid()) is null or not private.can_review_brand_map() then
    raise exception 'only an active doctor may review a brand mapping' using errcode = '42501';
  end if;
  select * into m from public.medicine_brand_generic_map where id = p_id for update;
  if not found then raise exception 'brand map row not found' using errcode = '22023'; end if;
  if p_approve then
    if p_seen_edited_at is distinct from m.edited_at then
      raise exception 'this row changed since you opened it; open it again and review what it says now' using errcode = '40001';
    end if;
    if m.created_by is not distinct from (select auth.uid()) or m.edited_by is not distinct from (select auth.uid()) then
      raise exception 'a row cannot be reviewed by the person who entered or last changed it' using errcode = '42501';
    end if;
    select nullif(btrim(full_name), '') into v_name from public.profiles where id = (select auth.uid());
    if v_name is null then raise exception 'the reviewer has no display name on their profile' using errcode = '22023'; end if;
    update public.medicine_brand_generic_map
       set reviewed_by = (select auth.uid()), reviewer_name = v_name, reviewed_at = now(), is_active = true
     where id = p_id;
  else
    update public.medicine_brand_generic_map
       set reviewed_by = null, reviewer_name = null, reviewed_at = null, is_active = false
     where id = p_id;
  end if;
  perform private.log_audit('medicine_brand_generic_map.' || case when p_approve then 'approved' else 'withdrawn' end,
    'medicine_brand_generic_map', p_id, '{}'::jsonb);
end $$;
revoke all on function public.review_medicine_brand_map(uuid, boolean, timestamptz) from public, anon;
grant execute on function public.review_medicine_brand_map(uuid, boolean, timestamptz) to authenticated;

create or replace function public.published_medicine_brands()
returns table (id uuid, brand_name text, ingredients text[], source_citation text, reviewer_name text, reviewed_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select m.id, m.brand_name, m.ingredients, m.source_citation, m.reviewer_name, m.reviewed_at
    from public.medicine_brand_generic_map m
   where m.is_active and m.reviewed_by is not null and (select auth.uid()) is not null
   order by m.brand_key
$$;
revoke all on function public.published_medicine_brands() from public, anon;
grant execute on function public.published_medicine_brands() to authenticated;

-- 4. The NAFDAC number a person noted from a pack -----------------------------------------------------------------------------------
create table if not exists public.medication_pack_numbers (
  medication_id   uuid primary key references public.medications (id) on delete cascade,
  organisation_id uuid not null references public.organisations (id),
  patient_id      uuid not null references public.profiles (id) on delete cascade,
  nafdac_number   text not null check (nafdac_number ~ '^[A-HJ-NP-Z]?[0-9]{1,2}-[0-9]{3,6}[A-HJ-NP-Z]?$'),
  recorded_by     uuid references public.profiles (id) on delete restrict,
  recorded_at     timestamptz not null default now()
);
comment on table public.medication_pack_numbers is
  'S08y. The NAFDAC registration number a person copied from a pack, kept as a note beside the medicine. Store only: nothing calls NAFDAC and nothing here says a pack is genuine. The format mirrors the PROPOSED config medicines.nafdac_number_format.';
create index if not exists medication_pack_numbers_patient_idx on public.medication_pack_numbers (patient_id);
create index if not exists medication_pack_numbers_org_idx on public.medication_pack_numbers (organisation_id);
alter table public.medication_pack_numbers enable row level security;
drop policy if exists medication_pack_numbers_select on public.medication_pack_numbers;
-- Read: the person, someone acting for them, a supporter holding the medicines category. No staff policy (like medication_supply).
create policy medication_pack_numbers_select on public.medication_pack_numbers for select to authenticated using (
  patient_id = (select auth.uid())
  or private.can_act_for(patient_id)
  or private.can_read_clinical(patient_id, 'medications'::public.care_access_category)
);
revoke all on public.medication_pack_numbers from public, anon, authenticated;
grant select on public.medication_pack_numbers to authenticated;

create or replace function public.set_medication_nafdac_number(p_medication uuid, p_number text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  m public.medications%rowtype;
  v_num text := upper(btrim(coalesce(p_number, '')));
begin
  if (select auth.uid()) is null then raise exception 'not authorised' using errcode = '42501'; end if;
  select * into m from public.medications where id = p_medication;
  if not found or (m.patient_id <> (select auth.uid()) and not private.can_act_for(m.patient_id)) then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  if m.superseded_at is not null then
    raise exception 'this medicine has been replaced by a newer version' using errcode = '22023';
  end if;
  if v_num = '' then
    delete from public.medication_pack_numbers where medication_id = p_medication;
    perform private.log_audit('medication_pack_numbers.cleared', 'medication', p_medication, '{}'::jsonb);
    return;
  end if;
  if v_num !~ '^[A-HJ-NP-Z]?[0-9]{1,2}-[0-9]{3,6}[A-HJ-NP-Z]?$' then
    raise exception 'that does not look like a NAFDAC number' using errcode = '22023';
  end if;
  insert into public.medication_pack_numbers (medication_id, organisation_id, patient_id, nafdac_number, recorded_by)
  values (p_medication, m.organisation_id, m.patient_id, v_num, (select auth.uid()))
  on conflict (medication_id) do update set nafdac_number = excluded.nafdac_number, recorded_by = excluded.recorded_by, recorded_at = now();
  perform private.log_audit('medication_pack_numbers.set', 'medication', p_medication, '{}'::jsonb);
end $$;
revoke all on function public.set_medication_nafdac_number(uuid, text) from public, anon;
grant execute on function public.set_medication_nafdac_number(uuid, text) to authenticated;

-- An amended prescription supersedes the row; the note describes the pack in the person's hand, so it follows the medicine.
create or replace function private.carry_pack_number_on_amend() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- previous_version_id is supplied by the inserting client, so the note is copied only from a pack number that belongs to the SAME
  -- person, and the new row's own owner and organisation are used, never the source row's.
  insert into public.medication_pack_numbers (medication_id, organisation_id, patient_id, nafdac_number, recorded_by, recorded_at)
  select new.id, new.organisation_id, new.patient_id, p.nafdac_number, p.recorded_by, p.recorded_at
    from public.medication_pack_numbers p
   where p.medication_id = new.previous_version_id and p.patient_id = new.patient_id
  on conflict (medication_id) do nothing;
  return null;
end $$;
drop trigger if exists medications_carry_pack_number on public.medications;
create trigger medications_carry_pack_number after insert on public.medications
  for each row when (new.previous_version_id is not null) execute function private.carry_pack_number_on_amend();

-- 5. The supporter's read-only "today's doses" ----------------------------------------------------------------------------------------
-- Gate: the `medications` category on profile_access_categories (or the standing guardian rule inside private.can_read_clinical for
-- a dependent account), written fresh here; the caregiver_permission array and the clinical_access flag are NOT consulted, so a
-- supporter without the category gets nothing. Returns only today's scheduled slots with the latest answer. As-needed medicines
-- are left out. The person's own list is the source of truth; this is a read of it.
create or replace function public.supporter_todays_doses(p_patient uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_today date := (now() at time zone 'Africa/Lagos')::date;
  v_doses jsonb;
  v_active integer;
begin
  if (select auth.uid()) is null then raise exception 'not authorised' using errcode = '42501'; end if;
  if p_patient is null or p_patient = (select auth.uid())
     or not private.can_read_clinical(p_patient, 'medications'::public.care_access_category) then
    return jsonb_build_object('status', 'not_shared');
  end if;
  if not private.go_live_open_patient('supporter_todays_doses', (select auth.uid())) then
    return jsonb_build_object('status', 'closed');
  end if;

  select count(*) into v_active from public.medications m
   where m.patient_id = p_patient and m.is_active and m.superseded_at is null and m.stopped_at is null;

  select coalesce(jsonb_agg(jsonb_build_object(
           'medication_id', s.med_id, 'name', s.name, 'time', s.slot_time, 'due_at', s.due_at,
           'answer', coalesce(v.status::text, 'none')) order by s.slot_time, s.name), '[]'::jsonb)
    into v_doses
    from (
      select m.id as med_id, m.drug_name as name, sl.slot_time,
             ((v_today + sl.slot_time::time) at time zone 'Africa/Lagos') as due_at,
             greatest(m.created_at, coalesce(m.schedule_effective_from, m.created_at)) as active_from
        from public.medications m
       cross join lateral private.medication_slots_on(m.schedule_spec, m.schedule_times, v_today) sl
       where m.patient_id = p_patient and m.is_active and m.superseded_at is null and m.stopped_at is null
         and coalesce(m.schedule_spec ->> 'kind', '') <> 'as_needed'
    ) s
    left join public.medication_logs_latest_per_slot v
      on v.medication_id = s.med_id and v.scheduled_for_date = v_today and v.scheduled_time = s.slot_time
   where s.due_at >= s.active_from;

  -- Every read is audited; a repeat by the same supporter inside ten minutes adds no second row. An audit failure fails the read (no swallow).
  if not exists (select 1 from public.audit_log a
                  where a.actor_id = (select auth.uid()) and a.action = 'supporter.todays_doses_viewed' and a.subject_patient_id = p_patient
                    and a.created_at > now() - interval '10 minutes') then
    -- the standard audited-read helper (INV-10): it records the subject person, so their own access log shows it
    perform private.audit_patient_read(p_patient, 'supporter_todays_doses', null, 'A supporter read today''s doses you shared', 'supporter.todays_doses_viewed');
  end if;
  -- active_medicines lets the screen say honestly when nothing is SCHEDULED, instead of looking like "all clear".
  return jsonb_build_object('status', 'ok', 'date', v_today, 'active_medicines', v_active, 'doses', v_doses);
end $$;
revoke all on function public.supporter_todays_doses(uuid) from public, anon;
grant execute on function public.supporter_todays_doses(uuid) to authenticated;

-- 6. Go-live guards, born OFF ---------------------------------------------------------------------------------------------------------
insert into public.go_live_guards (key, label, blocks, condition_text, switch_role, enforced_in, not_enforced_in) values
  ('medicine_duplicate_ingredient_check', 'Same-ingredient warning when adding a medicine',
   'The warning shown before a medicine is added when it shares an active ingredient with one already on the list',
   'The Chief Medical Officer has seen the wording and switched it on', 'cmo',
   array['the add-a-medicine form on the web and the phone (the check runs only while this guard is open for the person)'],
   'It only warns: adding a medicine is never blocked and nothing is changed. is_test accounts pass it so the flow can be rehearsed.'),
  ('medicine_interaction_rules', 'Governed interaction rules when adding a medicine',
   'Showing the signed interaction rules, as a warning, before a medicine is added',
   'The Chief Medical Officer has signed a non-empty rule set (after a pharmacist reviewed it)', 'cmo',
   array['public.active_medicine_interaction_rules (a client receives rules only while this guard is open and a signed set is active)'],
   'Warn only: adding a medicine is never blocked. Signing a set does not switch this on. is_test accounts pass the guard but still need a signed set.'),
  ('supporter_todays_doses', 'Supporter view: was today''s dose taken',
   'The read-only list of today''s doses a supporter sees for a person who shared their medicines',
   'The Chief Medical Officer has confirmed the wording and switched it on', 'cmo',
   array['public.supporter_todays_doses (returns nothing while the guard is closed)'],
   'The person''s own medicine list is never behind this guard. A supporter still needs the person''s medicines category; the guard adds nothing to what they may see.')
on conflict (key) do nothing;

create or replace function private.medicine_safety_go_live_conditions(p_key text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_ver integer;
begin
  if p_key = 'medicine_interaction_rules' then
    select version into v_ver from public.medicine_interaction_rule_sets
     where is_active and approved_by is not null and jsonb_array_length(config -> 'rules') > 0;
    return jsonb_build_array(
      private.go_live_cond('rules_signed', 'The Chief Medical Officer has signed a non-empty interaction rule set', v_ver is not null, 'data',
        case when v_ver is null then 'no signed version' else 'version ' || v_ver end),
      private.go_live_cond('cmo_switch', 'Chief Medical Officer sign-off', true, 'switch', 'Given by the Chief Medical Officer pressing the switch'));
  end if;
  return jsonb_build_array(
    private.go_live_cond('cmo_switch', 'Chief Medical Officer sign-off', true, 'switch', 'Given by the Chief Medical Officer pressing the switch'));
end $$;
revoke all on function private.medicine_safety_go_live_conditions(text) from public, anon, authenticated, service_role;

do $$
declare
  v_def text;
  v_anchor constant text := E'\n  end if;\n  -- An unknown key has no conditions';
begin
  v_def := pg_get_functiondef('private.go_live_conditions(text, uuid)'::regprocedure);
  if v_def like '%medicine_safety_go_live_conditions%' then return; end if;
  if position(v_anchor in v_def) = 0 then
    raise exception 'private.go_live_conditions no longer ends with the expected fall-through; add the medicine safety branch by hand' using errcode = '55000';
  end if;
  execute replace(v_def, v_anchor,
    E'\n  elsif p_key in (''medicine_duplicate_ingredient_check'', ''medicine_interaction_rules'', ''supporter_todays_doses'') then\n    return private.medicine_safety_go_live_conditions(p_key);\n  end if;\n  -- An unknown key has no conditions');
end $$;

-- 7. The patient-data registry (S39d). Left UNREVIEWED on purpose: a class review is the CMO's and DPO's to give. ------------------------
insert into public.data_registry (table_name, patient_expr, retention_class, end_of_retention, in_export, reviewed, notes)
values ('medication_pack_numbers', 'patient_id', private.retention_class_for('medication_pack_numbers'), 'review', true, false,
        'Added in S08y (2026-10-20). Class proposed by the standing name rule; awaiting the next CMO and DPO class review. No staff read policy exists, so there is no staff_read_scope row: tied staff do not read this table.')
on conflict (table_name) do nothing;

-- 8. Privileges, and the migration proves what it claims. The predicates a policy or a CHECK calls stay executable by authenticated
-- (they are evaluated as the caller); the rest are for definer functions only. -----------------------------------------------------------------------------------
revoke all on function private.split_ingredients(text) from public, anon, authenticated;
revoke all on function private.duplicate_ingredient_pairs(jsonb) from public, anon, authenticated;
revoke all on function private.interaction_rule_ok(jsonb) from public, anon;
grant execute on function private.interaction_rule_ok(jsonb) to authenticated;
revoke all on function private.interaction_rules_valid(jsonb) from public, anon;
grant execute on function private.interaction_rules_valid(jsonb) to authenticated;
revoke all on function private.ingredient_list_ok(text[]) from public, anon;
grant execute on function private.ingredient_list_ok(text[]) to authenticated;
revoke all on function private.can_edit_brand_map() from public, anon;
grant execute on function private.can_edit_brand_map() to authenticated;
revoke all on function private.can_review_brand_map() from public, anon;
grant execute on function private.can_review_brand_map() to authenticated;
revoke all on function private.brand_map_reset_review() from public, anon, authenticated;
revoke all on function private.carry_pack_number_on_amend() from public, anon, authenticated;

do $$
declare f text; t text;
begin
  foreach f in array array[
    'public.sign_medicine_interaction_rule_sets(uuid)', 'public.active_medicine_interaction_rules()',
    'public.save_medicine_brand_map(uuid,text,text[],text)', 'public.import_medicine_brand_map(jsonb)',
    'public.review_medicine_brand_map(uuid,boolean,timestamptz)', 'public.published_medicine_brands()', 'public.set_medication_nafdac_number(uuid,text)',
    'public.supporter_todays_doses(uuid)', 'private.split_ingredients(text)', 'private.duplicate_ingredient_pairs(jsonb)',
    'private.interaction_rules_valid(jsonb)', 'private.can_edit_brand_map()', 'private.can_review_brand_map()',
    'private.medicine_safety_go_live_conditions(text)']
  loop
    if has_function_privilege('anon', f, 'EXECUTE') then raise exception 'S08y: anon can execute %', f; end if;
  end loop;
  foreach t in array array['public.medicine_interaction_rule_sets', 'public.medicine_brand_generic_map', 'public.medication_pack_numbers']
  loop
    if has_table_privilege('anon', t, 'SELECT') then raise exception 'S08y: anon can read %', t; end if;
    if not has_table_privilege('authenticated', t, 'SELECT') then raise exception 'S08y: authenticated cannot read %', t; end if;
    if has_table_privilege('authenticated', t, 'UPDATE') or has_table_privilege('authenticated', t, 'DELETE') then
      raise exception 'S08y: authenticated can change %', t;
    end if;
  end loop;
  if has_table_privilege('authenticated', 'public.medicine_brand_generic_map', 'INSERT')
     or has_table_privilege('authenticated', 'public.medication_pack_numbers', 'INSERT') then
    raise exception 'S08y: authenticated can write a brand row or a pack number directly';
  end if;
  -- These hold on a fresh replay and on a re-run: v1 never carries a rule, and the three guards exist. (Whether a guard is on, or a set
  -- is signed, is a human's decision after this migration and is deliberately not asserted here, so a replay never fails on it.)
  if not exists (select 1 from public.medicine_interaction_rule_sets where version = 1 and jsonb_array_length(config -> 'rules') = 0) then
    raise exception 'S08y: v1 of the rule set is missing or carries a rule';
  end if;
  if (select count(*) from public.go_live_guards
       where key in ('medicine_duplicate_ingredient_check', 'medicine_interaction_rules', 'supporter_todays_doses')) <> 3 then
    raise exception 'S08y: a guard is missing';
  end if;
  if private.go_live_conditions('medicine_interaction_rules', null) is null then raise exception 'S08y: go_live_conditions has no medicine safety branch'; end if;
  if not exists (select 1 from public.data_registry where table_name = 'medication_pack_numbers') then raise exception 'S08y: pack numbers are not in the data registry'; end if;
end $$;
