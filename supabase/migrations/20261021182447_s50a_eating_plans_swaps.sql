-- S50a (v5 Module 6, functions 6.8 swaps and 6.9 condition eating plans; 6.14 is app wiring; 6.12 is DROPPED by founder decision S50-1).
-- Live project koiplnmbgnqnbywhpjlf checked 2026-10-21: latest live migration 20261021113500, nothing unrecognised. No table named
-- nutrition_guidance_config exists. Nothing is applied by this build.
--
--   1. nutrition_guidance_config: ONE versioned governed table holding the swap table and the five eating plans (hypertension, diabetes, kidney
--      disease, pregnancy, weight). Seeded UNSIGNED and INACTIVE. Signed only by the Chief Medical Officer (sign_nutrition_guidance_config).
--   2. my_nutrition_guidance(): the only way a patient receives a plan or a swap. Same identical-answer rule as my_nutrition_target_gate():
--      "not signed yet" and "not for you" are both {state:'unavailable'}.
--        - the weight plan, the swaps and the condition plans are withheld exactly when private.nutrition_targets_withheld() says so (S49a gate reused);
--        - the pregnancy plan is shown only to the patient herself, from her own record, and never to a patient a clinician hold, a positive
--          eating-disorder screen, an age under 18 or the postnatal year applies to; unknown or any doubt (including an unreadable date of birth) shows nothing.
--   3. nutrition_guidance_is_signed(): a global fact (is any version signed), carrying nothing about the caller, so the app knows when its
--      old built-in swap hints stop being the fallback.
--
-- The kidney and pregnancy plans carry general safe guidance and a prompt to see a dietitian or the care team ONLY: the validator refuses a
-- "numbers" block on either. Numbers elsewhere are listed under "placeholders" for the CMO to confirm.
-- RLS for the new table is written fresh (same shape as nutrition_target_config: staff and admin read, no patient read, no direct write).

-- 1. validator ----------------------------------------------------------------------------------------------------------------------
create function private.nutrition_guidance_config_valid(p_config jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare v_code text; v_plan jsonb; v_tip jsonb; v_swap jsonb; v_aud jsonb; v_to jsonb; v_codes text[] := array['hypertension', 'diabetes', 'kidney', 'pregnancy', 'weight'];
begin
  -- Every check is written so that a MISSING key fails (a NULL comparison would otherwise pass). Mirrors parseEatingGuidance in packages/shared.
  if jsonb_typeof(p_config -> 'swaps') is distinct from 'array' or jsonb_typeof(p_config -> 'plans') is distinct from 'object' then return false; end if;
  foreach v_code in array v_codes loop
    v_plan := p_config -> 'plans' -> v_code;
    if jsonb_typeof(v_plan) is distinct from 'object' then return false; end if;
    if coalesce(btrim(v_plan ->> 'title'), '') = '' or coalesce(btrim(v_plan ->> 'intro'), '') = '' then return false; end if;
    if jsonb_typeof(v_plan -> 'tips') is distinct from 'array' or jsonb_array_length(v_plan -> 'tips') = 0 then return false; end if;
    for v_tip in select * from jsonb_array_elements(v_plan -> 'tips') loop
      if coalesce(btrim(v_tip ->> 'heading'), '') = '' or coalesce(btrim(v_tip ->> 'body'), '') = '' then return false; end if;
    end loop;
    if coalesce(btrim(v_plan ->> 'care_team_prompt'), '') = '' then return false; end if;
    -- kidney disease and pregnancy: general safe guidance only. No nutrient or calorie number of any kind.
    if v_code in ('kidney', 'pregnancy') and (v_plan ? 'numbers') then return false; end if;
  end loop;
  if (select count(*) from jsonb_object_keys(p_config -> 'plans')) <> 5 then return false; end if;
  for v_swap in select * from jsonb_array_elements(p_config -> 'swaps') loop
    if jsonb_typeof(v_swap) is distinct from 'object' then return false; end if;
    if coalesce(btrim(v_swap ->> 'code'), '') = '' or coalesce(btrim(v_swap ->> 'from_food_code'), '') = '' or coalesce(btrim(v_swap ->> 'reason'), '') = '' then return false; end if;
    if jsonb_typeof(v_swap -> 'to_food_codes') is distinct from 'array' or jsonb_array_length(v_swap -> 'to_food_codes') = 0 then return false; end if;
    for v_to in select * from jsonb_array_elements(v_swap -> 'to_food_codes') loop
      if jsonb_typeof(v_to) is distinct from 'string' or btrim(v_to #>> '{}') = '' then return false; end if;
    end loop;
    if (v_swap ->> 'reason_kind') is null or (v_swap ->> 'reason_kind') not in ('less_salt', 'less_refined_carbohydrate', 'more_fibre', 'less_sugar', 'lighter_cooking') then return false; end if;
    if jsonb_typeof(v_swap -> 'for') is distinct from 'array' or jsonb_array_length(v_swap -> 'for') = 0 then return false; end if;
    for v_aud in select * from jsonb_array_elements(v_swap -> 'for') loop
      if (v_aud #>> '{}') is null or (v_aud #>> '{}') not in ('hypertension', 'diabetes', 'general') then return false; end if;
    end loop;
  end loop;
  return true;
exception when others then
  return false;
end $$;
grant execute on function private.nutrition_guidance_config_valid(jsonb) to authenticated;

-- 2. the governed table -------------------------------------------------------------------------------------------------------------
create table public.nutrition_guidance_config (
  id          uuid primary key default gen_random_uuid(),
  version     integer not null unique check (version >= 1),
  is_active   boolean not null default false,
  config      jsonb not null check (private.nutrition_guidance_config_valid(config)),
  notes       text,
  approved_by uuid references public.clinical_staff (id),
  approved_at timestamptz,
  created_at  timestamptz not null default now(),
  check ((approved_by is null) = (approved_at is null)),
  check (not is_active or approved_by is not null)
);
create unique index nutrition_guidance_config_one_active on public.nutrition_guidance_config (is_active) where is_active;
alter table public.nutrition_guidance_config enable row level security;
revoke all on public.nutrition_guidance_config from public, anon, authenticated;
grant select on public.nutrition_guidance_config to authenticated;
create policy nutrition_guidance_config_read on public.nutrition_guidance_config for select to authenticated
  using (exists (select 1 from public.clinical_staff cs where cs.profile_id = (select auth.uid()) and cs.active)
         or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin'));
create trigger refuse_superseded_activation before update of is_active on public.nutrition_guidance_config
  for each row when (new.is_active and not old.is_active)
  execute function private.refuse_activating_superseded_version();
comment on table public.nutrition_guidance_config is
  'S50a (6.8, 6.9): the swap table and the five condition eating plans as one versioned, CMO-signed configuration. Born unsigned and inactive. A patient reads it only through my_nutrition_guidance().';

-- nutrition-guidance-config-begin
insert into public.nutrition_guidance_config (version, is_active, config, notes)
values (1, false, $json${
 "swaps": [
  {"code": "white_rice_to_ofada", "from_food_code": "white_rice", "to_food_codes": ["ofada_rice"], "reason_kind": "more_fibre", "reason": "Ofada rice keeps more of the grain, so it has more fibre and usually fills you up for longer.", "for": ["diabetes", "general"]},
  {"code": "white_rice_and_beans", "from_food_code": "white_rice", "to_food_codes": ["beans_cooked"], "reason_kind": "more_fibre", "reason": "Mixing some beans in with your rice adds fibre and protein, and tends to be gentler on blood sugar than rice alone.", "for": ["diabetes", "general"]},
  {"code": "bread_to_sweet_potato", "from_food_code": "bread_white", "to_food_codes": ["sweet_potato_boiled"], "reason_kind": "less_refined_carbohydrate", "reason": "Boiled sweet potato is less refined than white bread and has more fibre.", "for": ["diabetes", "general"]},
  {"code": "semovita_to_tuwo_masara", "from_food_code": "semovita", "to_food_codes": ["tuwo_masara"], "reason_kind": "more_fibre", "reason": "A whole grain swallow such as tuwo masara usually has more fibre than a refined wheat swallow.", "for": ["diabetes", "general"]},
  {"code": "tuwo_shinkafa_to_tuwo_masara", "from_food_code": "tuwo_shinkafa", "to_food_codes": ["tuwo_masara"], "reason_kind": "more_fibre", "reason": "Tuwo masara usually has more fibre than tuwo shinkafa.", "for": ["diabetes", "general"]},
  {"code": "dried_fish_to_grilled", "from_food_code": "fish_dried", "to_food_codes": ["fish_grilled"], "reason_kind": "less_salt", "reason": "Fresh grilled fish usually carries much less salt than dried or stock fish.", "for": ["hypertension", "general"]},
  {"code": "smoked_fish_to_grilled", "from_food_code": "fish_smoked", "to_food_codes": ["fish_grilled"], "reason_kind": "less_salt", "reason": "Fresh grilled fish usually carries less salt than smoked fish.", "for": ["hypertension", "general"]},
  {"code": "suya_to_grilled_chicken", "from_food_code": "suya", "to_food_codes": ["chicken_grilled"], "reason_kind": "less_salt", "reason": "Grilled chicken you season yourself lets you control the salt and the spice mix.", "for": ["hypertension", "general"]},
  {"code": "noodles_to_boiled_spaghetti", "from_food_code": "indomie", "to_food_codes": ["spaghetti_boiled"], "reason_kind": "less_salt", "reason": "Instant noodles come with a seasoning sachet that is high in salt. Plain boiled spaghetti with your own fresh stew lets you choose how much.", "for": ["hypertension", "general"]},
  {"code": "plantain_chips_to_roasted", "from_food_code": "plantain_chips", "to_food_codes": ["plantain_roasted"], "reason_kind": "less_salt", "reason": "Roasted plantain has no added salt or frying oil.", "for": ["hypertension", "general"]},
  {"code": "fried_chicken_to_grilled", "from_food_code": "fried_chicken", "to_food_codes": ["chicken_grilled"], "reason_kind": "lighter_cooking", "reason": "Grilling uses less oil than frying and skips the salty coating.", "for": ["hypertension", "general"]},
  {"code": "chips_to_sweet_potato", "from_food_code": "fries", "to_food_codes": ["sweet_potato_boiled"], "reason_kind": "lighter_cooking", "reason": "Boiled sweet potato has no frying oil and no added salt.", "for": ["hypertension", "general"]},
  {"code": "soft_drink_to_zobo", "from_food_code": "soft_drink", "to_food_codes": ["zobo"], "reason_kind": "less_sugar", "reason": "Zobo you sweeten lightly yourself usually has far less sugar than a bottled soft drink.", "for": ["diabetes", "general"]},
  {"code": "malt_to_zobo", "from_food_code": "malt_drink", "to_food_codes": ["zobo"], "reason_kind": "less_sugar", "reason": "Zobo you sweeten lightly yourself usually has less sugar than a malt drink.", "for": ["diabetes", "general"]},
  {"code": "puff_puff_to_fruit", "from_food_code": "puff_puff", "to_food_codes": ["banana", "orange"], "reason_kind": "less_sugar", "reason": "A piece of fruit brings fibre along with its sugar, and is not fried.", "for": ["diabetes", "general"]},
  {"code": "chin_chin_to_groundnut", "from_food_code": "chin_chin", "to_food_codes": ["groundnut_roasted"], "reason_kind": "less_sugar", "reason": "A small handful of roasted groundnuts has no added sugar and more protein and fibre than a sweet fried snack.", "for": ["diabetes", "general"]}
 ],
 "plans": {
  "hypertension": {
   "title": "Eating for healthy blood pressure",
   "intro": "For blood pressure, the overall pattern across the week matters more than any single meal. These ideas are about adding things in and easing salt back, not about giving up foods you enjoy.",
   "tips": [
    {"heading": "Ease back on salt you cannot see", "body": "Seasoning cubes, dried and smoked fish, canned foods, instant noodle sachets and many snacks carry a lot of salt. Using fewer cubes, and fresh pepper, onion, ginger, garlic and herbs for flavour, makes a real difference."},
    {"heading": "Fresh food most days", "body": "Vegetables, fruit, beans and fresh fish or chicken most days is a good pattern for blood pressure."},
    {"heading": "Taste before you add", "body": "Taste your food before adding more salt at the table. Your taste adjusts within a few weeks."},
    {"heading": "Use your swaps", "body": "Your swap suggestions show lower salt choices for dishes you already eat."}
   ],
   "numbers": {"salt_g_max": 5},
   "care_team_prompt": "If you take blood pressure medicine or have kidney problems, ask your care team before changing how much salt or potassium you eat.",
   "placeholders": ["numbers.salt_g_max"]
  },
  "diabetes": {
   "title": "Eating for steady blood sugar",
   "intro": "For blood sugar, portion and pairing matter as much as the food itself. Spreading starchy food across the day and pairing it with vegetables, beans or protein tends to help more than avoiding any one food.",
   "tips": [
    {"heading": "Look at the starchy part", "body": "Rice, yam, swallow, bread and plantain are the parts that raise blood sugar most. A smaller portion of the starch with more vegetables and protein on the plate is usually gentler."},
    {"heading": "Add fibre", "body": "Beans, vegetables, whole grains and fruit with the skin on slow things down."},
    {"heading": "Sweet drinks and snacks", "body": "Sweet drinks raise blood sugar quickly. Water, or zobo you sweeten lightly yourself, is a gentler choice."},
    {"heading": "Use your swaps", "body": "Your swap suggestions show less refined choices for dishes you already eat."}
   ],
   "care_team_prompt": "If you take insulin or tablets that lower blood sugar, ask your care team before changing how much you eat or when you eat.",
   "placeholders": []
  },
  "kidney": {
   "title": "Eating well with kidney disease",
   "intro": "What is best to eat with kidney disease depends on your own blood tests and your stage of kidney disease, so it is not something to guess at. A dietitian can build a plan around your results.",
   "tips": [
    {"heading": "Ask before you change", "body": "Please do not cut out or add large amounts of any food group on your own, for example fruit, beans, or salt substitutes, without asking first."},
    {"heading": "Drink as advised", "body": "Ask your care team how much fluid is right for you."}
   ],
   "care_team_prompt": "Please talk to a dietitian or your care team about a plan built around your own results. Ask your care team about a dietitian visit.",
   "placeholders": []
  },
  "pregnancy": {
   "title": "Eating well in pregnancy",
   "intro": "Eating well in pregnancy is about regular meals, a variety of foods, and food that is safely prepared. Your care team can tailor this to you.",
   "tips": [
    {"heading": "Regular meals", "body": "Regular meals and snacks with a mix of vegetables, fruit, beans, eggs, fish or chicken, and starchy foods help."},
    {"heading": "Food safety", "body": "Cook meat, fish and eggs through, wash fruit and vegetables well, and avoid unpasteurised milk."},
    {"heading": "Ask about supplements", "body": "Ask your care team which supplements are right for you before taking any."}
   ],
   "care_team_prompt": "Please talk to your care team or a dietitian about what is right for you, and tell them about any sickness, cravings or foods you are avoiding.",
   "placeholders": []
  },
  "weight": {
   "title": "Eating for a healthy weight",
   "intro": "Steady, sustainable habits work better than strict rules. This plan has no calorie target; it is about the pattern of your meals.",
   "tips": [
    {"heading": "Fill half the plate with vegetables", "body": "Vegetables and soups add volume and fibre with fewer calories."},
    {"heading": "Watch the extras", "body": "Sweet drinks, fried snacks and large starchy portions add up quickly. Small swaps help; use your swap suggestions."},
    {"heading": "Eat slowly and regularly", "body": "Regular meals, eaten slowly, make it easier not to snack out of hunger."}
   ],
   "care_team_prompt": "If you would like a personal plan, or you are taking medicines for blood sugar or blood pressure, talk to your care team or book a dietitian before you change how you eat.",
   "placeholders": []
  }
 }
}$json$::jsonb,
        'PROPOSED, unsigned and INACTIVE. Swaps and the five eating plans for the CMO and a dietitian to review. Wording is coaching, never good-or-bad food. KIDNEY and PREGNANCY carry general safe guidance and a prompt to see a dietitian or the care team only (the database refuses a numbers block on either). The only number anywhere is plans.hypertension.numbers.salt_g_max = 5 (WHO), a PLACEHOLDER for the CMO to confirm. Weight plan has no calorie figure. Sign with sign_nutrition_guidance_config().');
-- nutrition-guidance-config-end

create function public.sign_nutrition_guidance_config(p_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_staff uuid;
begin
  if not exists (select 1 from public.nutrition_guidance_config where id = p_id) then raise exception 'Nutrition guidance config version not found'; end if;
  select cs.id into v_staff from public.clinical_staff cs
   where cs.profile_id = (select auth.uid()) and cs.active and cs.status = 'active' and cs.doctor_tier = 'chief_medical_officer' limit 1;
  if v_staff is null then raise exception 'not authorised: only the active Chief Medical Officer can sign the nutrition guidance config'; end if;
  update public.nutrition_guidance_config set is_active = false where is_active and id <> p_id;
  update public.nutrition_guidance_config set approved_by = v_staff, approved_at = now(), is_active = true where id = p_id;
  perform private.log_audit('nutrition_guidance_config.signed', 'nutrition_guidance_config', p_id, '{}'::jsonb);
  return p_id;
end $$;
revoke all on function public.sign_nutrition_guidance_config(uuid) from public, anon;
grant execute on function public.sign_nutrition_guidance_config(uuid) to authenticated;

-- 3. who may see a plan -------------------------------------------------------------------------------------------------------------
-- Pregnancy is read from the three places it is held, on the caller's OWN record only (the public function passes auth.uid() and nothing
-- else, and this one is not executable by a client), the rule the activity gate and the targets gate follow. Written fresh.
create function private.nutrition_pregnancy_known(p_patient uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select p.is_pregnant from public.profiles p where p.id = p_patient), false)
      or exists (select 1 from public.patient_pregnancy pp where pp.patient_id = p_patient and pp.is_pregnant)
      or exists (select 1 from public.reproductive_health_profiles rp where rp.patient_id = p_patient and rp.life_stage = 'pregnant')
$$;
revoke all on function private.nutrition_pregnancy_known(uuid) from public, anon, authenticated;

create function public.nutrition_guidance_is_signed() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.nutrition_guidance_config where is_active and approved_by is not null)
$$;
revoke all on function public.nutrition_guidance_is_signed() from public, anon;
grant execute on function public.nutrition_guidance_is_signed() to authenticated;
comment on function public.nutrition_guidance_is_signed() is 'S50a: whether any version is signed. A fact about the platform, not about the caller.';

create function public.my_nutrition_guidance() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid()); v_cfg public.nutrition_guidance_config%rowtype;
  v_plans jsonb := '[]'::jsonb; v_code text; v_conds text[];
begin
  if v_uid is null then return jsonb_build_object('state', 'unavailable'); end if;
  select * into v_cfg from public.nutrition_guidance_config where is_active and approved_by is not null;
  if not found then return jsonb_build_object('state', 'unavailable'); end if;

  if private.nutrition_pregnancy_known(v_uid) then
        -- Under 18 and the postnatal year are withheld here too (a stale pregnancy flag after a delivery must not keep a plan alive).
    if exists (select 1 from public.nutrition_target_holds h where h.patient_id = v_uid and h.cleared_at is null)
       or exists (select 1 from public.obesity_ed_screens e where e.patient_id = v_uid and e.positive)
       or exists (select 1 from public.postnatal_profiles np where np.patient_id = v_uid and np.delivery_date > (current_date - 365))
       or coalesce((select p.date_of_birth > (current_date - interval '18 years') from public.profiles p where p.id = v_uid), true) then
      return jsonb_build_object('state', 'unavailable');
    end if;
    return jsonb_build_object('state', 'ok', 'config_version', v_cfg.version, 'swaps', '[]'::jsonb,
      'plans', jsonb_build_array(jsonb_build_object('code', 'pregnancy') || (v_cfg.config -> 'plans' -> 'pregnancy')));
  end if;

  if private.nutrition_targets_withheld(v_uid) then return jsonb_build_object('state', 'unavailable'); end if;

  select coalesce(array_agg(distinct cp.condition::text), array[]::text[]) into v_conds
    from public.care_plans cp where cp.patient_id = v_uid and cp.status = 'active';
  foreach v_code in array array['hypertension', 'diabetes', 'kidney', 'weight'] loop
    if v_code = 'weight'
       or (v_code = 'kidney' and 'ckd' = any (v_conds))
       or (v_code in ('hypertension', 'diabetes') and v_code = any (v_conds)) then
      v_plans := v_plans || jsonb_build_array(jsonb_build_object('code', v_code) || (v_cfg.config -> 'plans' -> v_code));
    end if;
  end loop;
  return jsonb_build_object('state', 'ok', 'config_version', v_cfg.version, 'swaps', v_cfg.config -> 'swaps', 'plans', v_plans);
end $$;
revoke all on function public.my_nutrition_guidance() from public, anon;
grant execute on function public.my_nutrition_guidance() to authenticated;
comment on function public.my_nutrition_guidance() is
  'S50a: the only way a patient receives a swap or an eating plan. unavailable (not signed, or not for this person: indistinguishable) or ok with the signed swaps and the plans that apply to the caller.';

-- 4. Self-checks --------------------------------------------------------------------------------------------------------------------
do $$
declare v_missing text;
begin
  if (select count(*) from public.nutrition_guidance_config where is_active) <> 0 then raise exception 'S50a: the guidance config must be born inactive'; end if;
  if (select private.nutrition_guidance_config_valid(config) from public.nutrition_guidance_config where version = 1) is not true then raise exception 'S50a: the seed fails its own validator'; end if;
  select string_agg(x.c, ', ') into v_missing from (
    select s ->> 'from_food_code' as c from public.nutrition_guidance_config g, jsonb_array_elements(g.config -> 'swaps') s where g.version = 1
    union all
    select t from public.nutrition_guidance_config g, jsonb_array_elements(g.config -> 'swaps') s, jsonb_array_elements_text(s -> 'to_food_codes') t where g.version = 1) x
   where not exists (select 1 from public.nigerian_foods f where f.code = x.c);
  if v_missing is not null then raise exception 'S50a: swaps name foods that are not in the food list: %', v_missing; end if;
  if has_function_privilege('anon', 'public.my_nutrition_guidance()', 'EXECUTE') then raise exception 'S50a: anon can read guidance'; end if;
  if has_function_privilege('anon', 'public.nutrition_guidance_is_signed()', 'EXECUTE') then raise exception 'S50a: anon can ask if guidance is signed'; end if;
  if has_function_privilege('anon', 'public.sign_nutrition_guidance_config(uuid)', 'EXECUTE') then raise exception 'S50a: anon can sign'; end if;
  if has_function_privilege('authenticated', 'private.nutrition_pregnancy_known(uuid)', 'EXECUTE') then raise exception 'S50a: a client can ask who is pregnant'; end if;
  if has_table_privilege('anon', 'public.nutrition_guidance_config', 'SELECT') then raise exception 'S50a: anon can read the config'; end if;
  if has_table_privilege('authenticated', 'public.nutrition_guidance_config', 'INSERT') or has_table_privilege('authenticated', 'public.nutrition_guidance_config', 'UPDATE') then
    raise exception 'S50a: a client can write the config directly';
  end if;
end $$;
