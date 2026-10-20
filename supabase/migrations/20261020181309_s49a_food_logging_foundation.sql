-- S49a: food logging foundation (v5 Module 6, functions 6.1 to 6.5 and 6.7).
-- Part 2 of 2: the enum values it uses (wrap, ladle, bowl, fruit_veg) are added by the migration just before this one.
--
-- LIVE COUNT BEFORE (read 2026-10-20): nigerian_foods 41 rows, nutrition_log_entries 1 row, no table named barcodes, food_logs or
-- favourite_meals, nutrition_log_entries policies insert/select/update only. Nothing here converts existing rows; the one live
-- diary row only gains nullable columns and the new default 'patient' provenance.
--
--   1. nigerian_foods: sugar_g_100g, is_drink, needs_dietitian_review, generated high_salt / high_sugar flags; sugar backfilled for the
--      41 existing rows as ESTIMATES (data_quality stays 'estimated'); 67 new dishes, ALL data_quality 'estimated' and flagged for
--      dietitian review. Nothing here is marked reviewed and nothing may be: a dietitian does that, as a data change, per row.
--   2. wrap / ladle / bowl portions, and nigerian_food_portion_sizes: small / medium / large slots with a nullable photo_path. NO photos
--      exist yet; a null photo_path means the app shows the text description. Gram figures for the sizes are derived (0.6x, 1x, 1.5x of
--      the default portion), flagged as estimates.
--   3. nutrition_log_entries: client_id (idempotent offline replay, S06 pattern), client_recorded_at / received_at / time_basis,
--      source / recorded_by (S05 provenance). food_logs: a v5-named VIEW over it (security_invoker), no second store.
--   4. food.logged domain event (ids only in the payload, INV-07), emitted by a trigger that can never block a diary write.
--   5. favourite_meals; nutrition_preferences (meal summary mode); nutrition_target_holds (clinician hold, reason never shown to the patient).
--   6. nutrition_target_config: versioned, governed, SEEDED UNSIGNED AND INACTIVE. Until the CMO signs it no patient sees any target.
--      my_nutrition_target_gate() is the only door: it returns the config to a patient ONLY when targets are not withheld for them
--      (pregnancy, postpartum year, clinician hold, eating-disorder screen positive, under 18) and never says why; "withheld" and "not signed yet" return the same answer.
--   7. barcodes: team-curated Nigerian packaged foods with NAFDAC number; lookup_barcode(). No rows seeded: none can be stated with confidence.

-- 1. Food catalogue columns --------------------------------------------------------------------------------------------------------
alter table public.nigerian_foods
  add column if not exists sugar_g_100g numeric(6, 1) check (sugar_g_100g is null or sugar_g_100g >= 0),
  add column if not exists is_drink boolean not null default false,
  add column if not exists needs_dietitian_review boolean not null default true;

-- UK front-of-pack "high" lines: salt 1.5 g per 100 g (600 mg sodium); sugar 22.5 g per 100 g of food, 11.25 g per 100 ml of drink.
alter table public.nigerian_foods
  add column if not exists high_salt boolean generated always as (sodium_mg_100g >= 600) stored,
  add column if not exists high_sugar boolean generated always as (
    sugar_g_100g is not null and sugar_g_100g >= case when is_drink then 11.25 else 22.5 end
  ) stored;

alter table public.nigerian_foods
  add constraint nigerian_foods_reviewed_consistent
  check (needs_dietitian_review or data_quality = 'dietitian_reviewed');

comment on column public.nigerian_foods.needs_dietitian_review is
  'S49a: true until a dietitian has checked this row. Only a dietitian review (a data change) may set it false, together with data_quality = dietitian_reviewed.';
comment on column public.nigerian_foods.high_salt is 'S49a: generated, sodium >= 600 mg per 100 g (1.5 g salt), the UK front-of-pack high line. A flag, not advice.';
comment on column public.nigerian_foods.high_sugar is 'S49a: generated, total sugars >= 22.5 g per 100 g (11.25 for a drink), the UK high line. Total sugars, not free sugars.';

-- sugar for the 41 existing rows: estimates in the same spirit as their macros
update public.nigerian_foods f set sugar_g_100g = v.s
  from (values
    ('white_rice', 0.1), ('jollof_rice', 2.0), ('fried_rice', 1.5), ('yam_boiled', 0.5), ('plantain_boiled', 6.0), ('plantain_fried', 14.0),
    ('cassava_boiled', 1.7), ('garri', 0.5), ('maize_boiled', 3.2), ('potato_boiled', 0.8), ('semolina_dry', 0.5), ('eba', 0.1),
    ('amala', 0.5), ('pounded_yam', 0.5), ('fufu', 0.5), ('semovita', 0.5), ('beans_cooked', 0.3), ('moi_moi', 1.0), ('akara', 1.0),
    ('egusi_soup', 1.0), ('okra_soup', 1.0), ('vegetable_soup', 1.0), ('ewedu_soup', 0.5), ('afang_soup', 0.5), ('ogbono_soup', 0.5),
    ('pepper_soup', 0.5), ('chicken_grilled', 0.0), ('beef_cooked', 0.0), ('fish_grilled', 0.0), ('fish_dried', 0.0), ('eggs_boiled', 1.1),
    ('goat_meat_cooked', 0.0), ('shrimp_cooked', 0.2), ('suya', 1.5), ('meat_pie', 3.0), ('biscuits', 25.0), ('soft_drink', 10.6),
    ('malt_drink', 8.0), ('fruit_drink', 11.5), ('zobo', 7.5), ('kunu', 2.0)
  ) as v(code, s)
 where f.code = v.code and f.sugar_g_100g is null;
update public.nigerian_foods set is_drink = true where code in ('soft_drink', 'malt_drink', 'fruit_drink', 'zobo', 'kunu');

-- 67 new dishes. Every value is an ESTIMATE from published West African and general composition ranges, per 100 g as served.
-- (code, name, aliases, category, cost_tier, kcal, carbs, protein, fat, fibre, sodium_mg, sugar, is_drink, note)
insert into public.nigerian_foods
  (code, name, aliases, category, cost_tier, calories_kcal_100g, carbs_g_100g, protein_g_100g, fat_g_100g, fibre_g_100g, sodium_mg_100g,
   sugar_g_100g, is_drink, data_quality, needs_dietitian_review, source_note)
select v.code, v.name, v.aliases, v.category::public.nigerian_food_category, v.cost::public.food_cost_tier, v.kcal, v.carbs, v.prot, v.fat,
       v.fibre, v.na, v.sugar, v.is_drink, 'estimated', true,
       'S49a 2026-10-20: estimate from published composition ranges, not dietitian reviewed. ' || v.note
  from (values
  -- rice, pasta, tubers, breakfast staples
  ('ofada_rice', 'Ofada rice (cooked)', array['ofada'], 'staple', 'mid', 130, 28.0, 2.8, 0.9, 1.5, 2, 0.1, false, 'Unpolished local rice, plain boiled.'),
  ('coconut_rice', 'Coconut rice', array[]::text[], 'staple', 'mid', 190, 28.0, 3.2, 7.0, 1.0, 150, 1.5, false, 'Rice cooked in coconut milk and oil.'),
  ('white_rice_stew', 'White rice and stew', array['rice and stew'], 'staple', 'mid', 165, 26.0, 3.2, 5.5, 1.0, 260, 2.0, false, 'Typical home plate: boiled rice with tomato stew; stew oil varies.'),
  ('jollof_spaghetti', 'Jollof spaghetti', array['spaghetti jollof'], 'staple', 'mid', 175, 28.0, 4.5, 5.0, 1.5, 300, 2.5, false, 'Spaghetti cooked in a tomato and pepper base with oil.'),
  ('spaghetti_boiled', 'Boiled spaghetti', array['plain spaghetti'], 'staple', 'budget', 158, 31.0, 5.8, 0.9, 1.8, 1, 0.6, false, 'Plain boiled, no sauce or salt.'),
  ('indomie', 'Instant noodles (cooked)', array['indomie', 'noodles'], 'staple', 'budget', 150, 22.0, 3.5, 5.5, 1.0, 380, 1.0, false, 'Prepared with the seasoning sachet; sodium varies with how much sachet is used.'),
  ('yam_fried', 'Fried yam', array['yam chips'], 'staple', 'budget', 190, 30.0, 2.0, 7.5, 3.5, 15, 0.8, false, 'Yam pieces shallow fried; fat depends on oil used.'),
  ('yam_porridge', 'Yam porridge', array['asaro', 'yam pottage'], 'staple', 'mid', 140, 22.0, 2.0, 5.0, 2.5, 200, 1.5, false, 'Yam cooked in a pepper and palm oil sauce.'),
  ('sweet_potato_boiled', 'Boiled sweet potato', array['potato boiled sweet'], 'staple', 'budget', 86, 20.0, 1.6, 0.1, 3.0, 27, 6.5, false, 'Boiled, with skin removed.'),
  ('plantain_roasted', 'Roasted plantain', array['boli'], 'staple', 'budget', 155, 38.0, 1.5, 0.3, 2.3, 5, 16.0, false, 'Ripe plantain roasted over fire; riper plantain has more sugar.'),
  ('pap', 'Pap', array['ogi', 'akamu', 'koko'], 'staple', 'budget', 55, 12.0, 1.0, 0.2, 0.4, 5, 2.0, false, 'Fermented maize or millet pap, a little sugar; sugar varies a lot.'),
  ('custard', 'Custard (prepared)', array[]::text[], 'staple', 'budget', 95, 17.0, 2.8, 1.8, 0.1, 40, 10.0, false, 'Custard powder made with milk and sugar.'),
  ('bread_white', 'Bread (white)', array['agege bread', 'bread'], 'staple', 'budget', 265, 49.0, 9.0, 3.2, 2.7, 490, 5.0, false, 'Typical white loaf; the portion is a slice.'),
  ('oat_porridge', 'Oats porridge', array['oatmeal', 'oats'], 'staple', 'mid', 70, 12.0, 2.5, 1.4, 1.7, 5, 0.5, false, 'Made with water, no sugar.'),
  ('cocoyam_boiled', 'Boiled cocoyam', array['coco yam'], 'staple', 'budget', 112, 26.0, 1.5, 0.2, 4.1, 10, 0.4, false, 'Boiled, no oil or salt.'),
  -- swallows
  ('tuwo_shinkafa', 'Tuwo shinkafa', array['rice swallow', 'tuwo'], 'swallow', 'budget', 140, 31.0, 2.6, 0.3, 0.5, 3, 0.0, false, 'Soft-boiled rice swallow.'),
  ('tuwo_masara', 'Tuwo masara', array['maize swallow'], 'swallow', 'budget', 125, 28.0, 2.8, 0.8, 1.6, 3, 0.0, false, 'Maize flour swallow.'),
  ('wheat_swallow', 'Wheat swallow', array['whole wheat swallow', 'wheat meal'], 'swallow', 'mid', 135, 29.0, 4.5, 0.7, 2.8, 4, 0.3, false, 'Whole wheat flour swallow.'),
  ('poundo_yam', 'Poundo yam', array['yam flour swallow', 'poundo'], 'swallow', 'mid', 135, 31.0, 1.7, 0.2, 1.5, 8, 0.5, false, 'Instant yam flour swallow.'),
  ('plantain_swallow', 'Plantain swallow', array['plantain fufu'], 'swallow', 'mid', 135, 33.0, 1.0, 0.2, 1.8, 6, 6.0, false, 'Unripe plantain flour swallow.'),
  -- soups and stews (as served, without the swallow)
  ('tomato_stew', 'Tomato stew', array['stew', 'obe ata'], 'soup', 'budget', 120, 6.0, 3.5, 9.0, 1.5, 380, 3.5, false, 'Pepper and tomato stew with oil; oil quantity drives the fat.'),
  ('ayamase', 'Ofada stew', array['ayamase', 'designer stew'], 'soup', 'mid', 190, 4.0, 8.0, 16.0, 1.5, 420, 2.0, false, 'Green pepper and palm oil stew with assorted meat.'),
  ('banga_soup', 'Banga soup', array['ofe akwu', 'palm nut soup'], 'soup', 'mid', 200, 4.0, 9.0, 17.0, 2.0, 430, 1.0, false, 'Palm nut soup with fish or meat.'),
  ('oha_soup', 'Oha soup', array['ofe oha'], 'soup', 'mid', 150, 4.0, 9.0, 11.0, 3.0, 400, 0.8, false, 'Oha leaf soup, cocoyam thickened.'),
  ('white_soup', 'White soup', array['nsala', 'ofe nsala'], 'soup', 'mid', 120, 5.0, 10.0, 7.0, 1.5, 420, 0.5, false, 'Yam thickened white soup with fish.'),
  ('edikang_ikong', 'Edikang ikong', array['ugu and waterleaf soup'], 'soup', 'mid', 160, 4.0, 11.0, 11.0, 3.0, 430, 0.8, false, 'Pumpkin leaf and waterleaf soup with assorted meat.'),
  ('gbegiri', 'Gbegiri', array['bean soup'], 'soup', 'budget', 95, 12.0, 5.5, 3.0, 3.5, 300, 1.0, false, 'Peeled bean soup, lightly oiled.'),
  ('chicken_stew', 'Chicken stew', array[]::text[], 'soup', 'mid', 150, 5.0, 13.0, 9.0, 1.2, 420, 3.0, false, 'Chicken in tomato stew.'),
  ('fish_stew', 'Fish stew', array[]::text[], 'soup', 'mid', 130, 5.0, 12.0, 7.0, 1.2, 400, 3.0, false, 'Fish in tomato stew.'),
  -- beans and nuts
  ('beans_porridge', 'Beans porridge', array['ewa riro'], 'legume', 'budget', 140, 20.0, 7.0, 4.0, 5.0, 280, 2.5, false, 'Beans cooked soft with palm oil and pepper.'),
  ('ewa_agoyin', 'Ewa agoyin', array['mashed beans'], 'legume', 'budget', 160, 19.0, 8.0, 6.0, 6.0, 340, 2.0, false, 'Mashed beans with the hot pepper sauce.'),
  -- proteins
  ('fried_chicken', 'Fried chicken', array[]::text[], 'protein', 'mid', 260, 8.0, 20.0, 17.0, 0.3, 420, 0.3, false, 'Battered or seasoned and deep fried, with skin.'),
  ('turkey_fried', 'Fried turkey', array['turkey'], 'protein', 'mid', 270, 6.0, 21.0, 18.0, 0.3, 400, 0.2, false, 'Fried turkey pieces.'),
  ('fish_fried', 'Fried fish', array[]::text[], 'protein', 'mid', 190, 3.0, 22.0, 10.0, 0.1, 300, 0.1, false, 'Fish fried in vegetable oil.'),
  ('fish_smoked', 'Smoked fish', array['smoked catfish'], 'protein', 'mid', 190, 0.0, 40.0, 3.5, 0.0, 500, 0.0, false, 'Smoked, dried; sodium varies with curing.'),
  ('ponmo', 'Cow skin', array['ponmo', 'kpomo'], 'protein', 'budget', 150, 0.0, 30.0, 3.0, 0.0, 200, 0.0, false, 'Boiled cow skin; protein is mostly collagen.'),
  ('egg_fried', 'Fried egg', array['omelette', 'omelet'], 'protein', 'budget', 195, 1.0, 13.0, 15.0, 0.0, 200, 0.5, false, 'Fried or omelette in oil.'),
  ('kilishi', 'Kilishi', array['dried spiced beef'], 'protein', 'premium', 380, 10.0, 50.0, 15.0, 2.0, 1500, 3.0, false, 'Dried spiced beef with groundnut paste; genuinely high in salt.'),
  ('gizzard_peppered', 'Peppered gizzard', array['gizzard'], 'protein', 'mid', 190, 3.0, 26.0, 8.0, 0.0, 220, 1.0, false, 'Chicken gizzard fried in pepper sauce.'),
  -- street food and snacks
  ('puff_puff', 'Puff puff', array[]::text[], 'snack_drink', 'budget', 350, 45.0, 6.0, 16.0, 1.5, 200, 8.0, false, 'Deep fried dough balls.'),
  ('chin_chin', 'Chin chin', array[]::text[], 'snack_drink', 'budget', 480, 60.0, 7.0, 23.0, 1.5, 170, 13.0, false, 'Fried sweet dough snack.'),
  ('doughnut', 'Doughnut', array[]::text[], 'snack_drink', 'budget', 420, 50.0, 6.0, 22.0, 1.5, 250, 15.0, false, 'Fried dough, lightly sugared.'),
  ('sausage_roll', 'Sausage roll', array[]::text[], 'snack_drink', 'budget', 340, 28.0, 9.0, 22.0, 1.2, 500, 2.5, false, 'Pastry with sausage meat.'),
  ('egg_roll', 'Egg roll', array[]::text[], 'snack_drink', 'budget', 300, 30.0, 8.0, 16.0, 1.2, 350, 3.0, false, 'Boiled egg wrapped in fried dough.'),
  ('fries', 'Chips', array['fries', 'potato chips', 'french fries'], 'snack_drink', 'mid', 310, 41.0, 3.4, 15.0, 3.8, 210, 0.5, false, 'Deep fried potato, lightly salted.'),
  ('shawarma', 'Shawarma', array[]::text[], 'snack_drink', 'mid', 230, 22.0, 12.0, 10.0, 1.8, 520, 3.0, false, 'Wrap with grilled meat, vegetables and sauce; very variable.'),
  ('plantain_chips', 'Plantain chips', array[]::text[], 'snack_drink', 'budget', 520, 58.0, 2.0, 32.0, 3.0, 300, 6.0, false, 'Deep fried plantain crisps.'),
  ('groundnut_roasted', 'Roasted groundnuts', array['peanuts', 'groundnut'], 'snack_drink', 'budget', 590, 21.0, 26.0, 49.0, 8.0, 5, 4.0, false, 'Dry roasted, unsalted.'),
  -- fruit and fresh vegetables
  ('banana', 'Banana', array[]::text[], 'fruit_veg', 'budget', 89, 22.8, 1.1, 0.3, 2.6, 1, 12.2, false, 'Ripe, peeled.'),
  ('orange', 'Orange', array[]::text[], 'fruit_veg', 'budget', 47, 11.8, 0.9, 0.1, 2.4, 0, 9.4, false, 'Peeled fruit, not juice.'),
  ('pawpaw', 'Pawpaw', array['papaya'], 'fruit_veg', 'budget', 43, 11.0, 0.5, 0.3, 1.7, 8, 7.8, false, 'Ripe, without seeds or skin.'),
  ('pineapple', 'Pineapple', array[]::text[], 'fruit_veg', 'budget', 50, 13.1, 0.5, 0.1, 1.4, 1, 9.9, false, 'Fresh slices.'),
  ('watermelon', 'Watermelon', array[]::text[], 'fruit_veg', 'budget', 30, 7.6, 0.6, 0.2, 0.4, 1, 6.2, false, 'Fresh flesh.'),
  ('mango', 'Mango', array[]::text[], 'fruit_veg', 'budget', 60, 15.0, 0.8, 0.4, 1.6, 1, 13.7, false, 'Ripe flesh.'),
  ('garden_egg', 'Garden egg', array['eggplant', 'aubergine'], 'fruit_veg', 'budget', 25, 5.9, 1.0, 0.2, 3.0, 2, 3.5, false, 'Raw or lightly cooked.'),
  ('cucumber', 'Cucumber', array[]::text[], 'fruit_veg', 'budget', 15, 3.6, 0.7, 0.1, 0.5, 2, 1.7, false, 'Raw.'),
  ('tomato_fresh', 'Fresh tomato', array['tomatoes'], 'fruit_veg', 'budget', 18, 3.9, 0.9, 0.2, 1.2, 5, 2.6, false, 'Raw.'),
  ('avocado', 'Avocado', array['pear'], 'fruit_veg', 'mid', 160, 8.5, 2.0, 14.7, 6.7, 7, 0.7, false, 'Ripe flesh; high in fat, mostly unsaturated.'),
  ('coconut_fresh', 'Fresh coconut', array['coconut'], 'fruit_veg', 'budget', 354, 15.0, 3.3, 33.0, 9.0, 20, 6.2, false, 'Fresh flesh.'),
  ('apple', 'Apple', array[]::text[], 'fruit_veg', 'mid', 52, 13.8, 0.3, 0.2, 2.4, 1, 10.4, false, 'With skin.'),
  -- drinks
  ('tea_milk_sugar', 'Tea with milk and sugar', array['tea'], 'snack_drink', 'budget', 35, 6.0, 0.8, 0.8, 0.0, 12, 5.5, true, 'One level spoon of sugar per cup assumed; sugar varies a lot.'),
  ('chocolate_malt_drink', 'Chocolate malt drink (prepared)', array['milo', 'bournvita'], 'snack_drink', 'mid', 80, 12.0, 3.0, 2.4, 0.5, 50, 9.0, true, 'Made with milk and sugar.'),
  ('milk_whole', 'Milk (whole)', array['fresh milk', 'peak milk'], 'snack_drink', 'mid', 61, 4.8, 3.2, 3.3, 0.0, 43, 4.8, true, 'Liquid whole milk or reconstituted powder.'),
  ('yoghurt_drink', 'Yoghurt drink', array['yogurt', 'drinking yoghurt'], 'snack_drink', 'mid', 70, 11.0, 2.8, 1.5, 0.0, 45, 10.5, true, 'Sweetened drinking yoghurt.'),
  ('energy_drink', 'Energy drink', array[]::text[], 'snack_drink', 'mid', 45, 11.0, 0.0, 0.0, 0.0, 40, 11.0, true, 'Regular sweetened energy drink.'),
  ('chapman', 'Chapman', array[]::text[], 'snack_drink', 'mid', 40, 9.5, 0.1, 0.0, 0.1, 5, 9.0, true, 'Sweetened fruit cocktail; very variable.'),
  ('soya_milk', 'Soya milk', array['soy milk', 'soy drink'], 'snack_drink', 'mid', 45, 3.5, 3.3, 1.9, 0.3, 12, 3.0, true, 'Lightly sweetened.')
  ) as v(code, name, aliases, category, cost, kcal, carbs, prot, fat, fibre, na, sugar, is_drink, note)
on conflict (code) do nothing;

-- 2. Portions ---------------------------------------------------------------------------------------------------------------------
-- Estimated household measures. Exactly one default per food (the unique partial index enforces it).
insert into public.nigerian_food_portions (food_id, unit, grams, is_default)
select f.id, p.unit::public.food_portion_unit, p.grams, p.is_default
  from (values
  ('ofada_rice', 'serving', 200, true), ('ofada_rice', 'plate', 250, false), ('ofada_rice', 'cup', 150, false), ('ofada_rice', 'spoon', 30, false),
  ('coconut_rice', 'serving', 200, true), ('coconut_rice', 'plate', 250, false), ('coconut_rice', 'spoon', 30, false),
  ('white_rice_stew', 'serving', 300, true), ('white_rice_stew', 'plate', 350, false),
  ('jollof_spaghetti', 'serving', 200, true), ('jollof_spaghetti', 'plate', 250, false), ('jollof_spaghetti', 'spoon', 30, false),
  ('spaghetti_boiled', 'serving', 200, true), ('spaghetti_boiled', 'plate', 250, false),
  ('indomie', 'serving', 250, true), ('indomie', 'bowl', 300, false),
  ('yam_fried', 'serving', 150, true), ('yam_fried', 'piece', 40, false), ('yam_fried', 'handful', 100, false),
  ('yam_porridge', 'serving', 300, true), ('yam_porridge', 'bowl', 300, false), ('yam_porridge', 'ladle', 100, false), ('yam_porridge', 'plate', 350, false),
  ('sweet_potato_boiled', 'serving', 150, true), ('sweet_potato_boiled', 'piece', 130, false),
  ('plantain_roasted', 'piece', 150, true), ('plantain_roasted', 'serving', 150, false),
  ('pap', 'serving', 250, true), ('pap', 'cup', 250, false), ('pap', 'ladle', 100, false), ('pap', 'bowl', 300, false),
  ('custard', 'serving', 250, true), ('custard', 'cup', 250, false), ('custard', 'ladle', 100, false), ('custard', 'bowl', 300, false),
  ('bread_white', 'piece', 35, true), ('bread_white', 'serving', 70, false),
  ('oat_porridge', 'serving', 250, true), ('oat_porridge', 'bowl', 300, false), ('oat_porridge', 'cup', 250, false),
  ('cocoyam_boiled', 'serving', 150, true), ('cocoyam_boiled', 'piece', 100, false),
  ('tuwo_shinkafa', 'wrap', 250, true), ('tuwo_shinkafa', 'serving', 200, false),
  ('tuwo_masara', 'wrap', 250, true), ('tuwo_masara', 'serving', 200, false),
  ('wheat_swallow', 'wrap', 250, true), ('wheat_swallow', 'serving', 200, false),
  ('poundo_yam', 'wrap', 250, true), ('poundo_yam', 'serving', 200, false), ('poundo_yam', 'piece', 200, false),
  ('plantain_swallow', 'wrap', 250, true), ('plantain_swallow', 'serving', 200, false),
  ('tomato_stew', 'serving', 150, true), ('tomato_stew', 'ladle', 75, false), ('tomato_stew', 'spoon', 20, false), ('tomato_stew', 'cup', 200, false),
  ('ayamase', 'serving', 200, true), ('ayamase', 'ladle', 80, false), ('ayamase', 'spoon', 20, false),
  ('banga_soup', 'serving', 300, true), ('banga_soup', 'ladle', 100, false), ('banga_soup', 'bowl', 300, false), ('banga_soup', 'cup', 200, false),
  ('oha_soup', 'serving', 300, true), ('oha_soup', 'ladle', 100, false), ('oha_soup', 'bowl', 300, false), ('oha_soup', 'cup', 200, false),
  ('white_soup', 'serving', 300, true), ('white_soup', 'ladle', 100, false), ('white_soup', 'bowl', 300, false), ('white_soup', 'cup', 200, false),
  ('edikang_ikong', 'serving', 300, true), ('edikang_ikong', 'ladle', 100, false), ('edikang_ikong', 'bowl', 300, false), ('edikang_ikong', 'cup', 200, false),
  ('gbegiri', 'serving', 250, true), ('gbegiri', 'ladle', 100, false), ('gbegiri', 'bowl', 300, false),
  ('chicken_stew', 'serving', 200, true), ('chicken_stew', 'ladle', 80, false),
  ('fish_stew', 'serving', 200, true), ('fish_stew', 'ladle', 80, false),
  ('beans_porridge', 'serving', 300, true), ('beans_porridge', 'bowl', 300, false), ('beans_porridge', 'ladle', 100, false), ('beans_porridge', 'plate', 350, false),
  ('ewa_agoyin', 'serving', 200, true), ('ewa_agoyin', 'spoon', 25, false), ('ewa_agoyin', 'plate', 250, false),
  ('groundnut_roasted', 'handful', 30, true), ('groundnut_roasted', 'cup', 140, false), ('groundnut_roasted', 'spoon', 15, false),
  ('fried_chicken', 'piece', 100, true), ('fried_chicken', 'serving', 150, false),
  ('turkey_fried', 'piece', 120, true), ('turkey_fried', 'serving', 150, false),
  ('fish_fried', 'piece', 100, true), ('fish_fried', 'serving', 120, false),
  ('fish_smoked', 'piece', 60, true), ('fish_smoked', 'serving', 100, false),
  ('ponmo', 'piece', 50, true), ('ponmo', 'serving', 100, false),
  ('egg_fried', 'piece', 60, true), ('egg_fried', 'serving', 120, false),
  ('kilishi', 'handful', 30, true), ('kilishi', 'serving', 50, false),
  ('gizzard_peppered', 'handful', 60, true), ('gizzard_peppered', 'serving', 100, false),
  ('puff_puff', 'piece', 30, true), ('puff_puff', 'handful', 90, false), ('puff_puff', 'serving', 120, false),
  ('chin_chin', 'handful', 40, true), ('chin_chin', 'cup', 90, false), ('chin_chin', 'serving', 50, false),
  ('doughnut', 'piece', 70, true), ('doughnut', 'serving', 70, false),
  ('sausage_roll', 'piece', 80, true), ('sausage_roll', 'serving', 80, false),
  ('egg_roll', 'piece', 100, true), ('egg_roll', 'serving', 100, false),
  ('fries', 'serving', 150, true), ('fries', 'handful', 80, false), ('fries', 'plate', 250, false),
  ('shawarma', 'wrap', 250, true), ('shawarma', 'piece', 250, false),
  ('plantain_chips', 'handful', 30, true), ('plantain_chips', 'serving', 50, false),
  ('banana', 'piece', 120, true), ('banana', 'serving', 120, false),
  ('orange', 'piece', 130, true), ('orange', 'serving', 130, false),
  ('pawpaw', 'serving', 200, true), ('pawpaw', 'piece', 150, false),
  ('pineapple', 'serving', 150, true), ('pineapple', 'piece', 80, false),
  ('watermelon', 'serving', 250, true), ('watermelon', 'piece', 200, false),
  ('mango', 'piece', 180, true), ('mango', 'serving', 180, false),
  ('garden_egg', 'piece', 40, true), ('garden_egg', 'serving', 100, false),
  ('cucumber', 'serving', 100, true), ('cucumber', 'piece', 200, false),
  ('tomato_fresh', 'piece', 80, true), ('tomato_fresh', 'serving', 120, false),
  ('avocado', 'piece', 100, true), ('avocado', 'serving', 100, false),
  ('coconut_fresh', 'piece', 45, true), ('coconut_fresh', 'handful', 40, false),
  ('apple', 'piece', 180, true), ('apple', 'serving', 180, false),
  ('tea_milk_sugar', 'cup', 250, true), ('tea_milk_sugar', 'serving', 300, false),
  ('chocolate_malt_drink', 'cup', 250, true), ('chocolate_malt_drink', 'serving', 300, false),
  ('milk_whole', 'cup', 250, true), ('milk_whole', 'serving', 250, false),
  ('yoghurt_drink', 'cup', 250, true), ('yoghurt_drink', 'serving', 300, false),
  ('energy_drink', 'cup', 250, true), ('energy_drink', 'serving', 330, false),
  ('chapman', 'cup', 250, true), ('chapman', 'serving', 350, false),
  ('soya_milk', 'cup', 250, true), ('soya_milk', 'serving', 250, false)
  ) as p(code, unit, grams, is_default)
  join public.nigerian_foods f on f.code = p.code
on conflict (food_id, unit) do nothing;

-- wrap, ladle and bowl for dishes that already existed (never a default: the existing default stays)
insert into public.nigerian_food_portions (food_id, unit, grams, is_default)
select f.id, p.unit::public.food_portion_unit, p.grams, false
  from (values
  ('eba', 'wrap', 250), ('amala', 'wrap', 250), ('pounded_yam', 'wrap', 250), ('fufu', 'wrap', 250), ('semovita', 'wrap', 250), ('moi_moi', 'wrap', 120),
  ('egusi_soup', 'ladle', 100), ('okra_soup', 'ladle', 100), ('vegetable_soup', 'ladle', 100), ('ewedu_soup', 'ladle', 80), ('afang_soup', 'ladle', 100),
  ('ogbono_soup', 'ladle', 100), ('pepper_soup', 'ladle', 80),
  ('egusi_soup', 'bowl', 300), ('okra_soup', 'bowl', 300), ('vegetable_soup', 'bowl', 300), ('ewedu_soup', 'bowl', 250), ('afang_soup', 'bowl', 300),
  ('ogbono_soup', 'bowl', 300), ('pepper_soup', 'bowl', 300), ('beans_cooked', 'bowl', 250), ('beans_cooked', 'ladle', 100)
  ) as p(code, unit, grams)
  join public.nigerian_foods f on f.code = p.code
on conflict (food_id, unit) do nothing;

-- size slots with photo placeholders. Photos are NOT supplied: photo_path stays null and the app falls back to words.
create table public.nigerian_food_portion_sizes (
  id          uuid primary key default gen_random_uuid(),
  food_id     uuid not null references public.nigerian_foods (id) on delete cascade,
  unit        public.food_portion_unit not null,
  size        text not null check (size in ('small', 'medium', 'large')),
  grams       numeric(6, 1) not null check (grams > 0),
  grams_basis text not null default 'derived_from_default' check (grams_basis in ('derived_from_default', 'measured')),
  photo_path  text,
  photo_alt   text,
  created_at  timestamptz not null default now(),
  unique (food_id, unit, size)
);
create index nigerian_food_portion_sizes_food_idx on public.nigerian_food_portion_sizes (food_id);
comment on table public.nigerian_food_portion_sizes is
  'S49a (6.2): small / medium / large of a household measure with a slot for a photo. photo_path is null until the content team supplies a real photo; never fabricate one. grams are 0.6x / 1x / 1.5x of the default portion until measured.';
alter table public.nigerian_food_portion_sizes enable row level security;
revoke all on public.nigerian_food_portion_sizes from public, anon, authenticated;
grant select, insert, update on public.nigerian_food_portion_sizes to authenticated;
create policy nigerian_food_portion_sizes_select on public.nigerian_food_portion_sizes for select to authenticated using (true);
create policy nigerian_food_portion_sizes_insert on public.nigerian_food_portion_sizes for insert to authenticated with check (private.is_admin());
create policy nigerian_food_portion_sizes_update on public.nigerian_food_portion_sizes for update to authenticated using (private.is_admin()) with check (private.is_admin());

insert into public.nigerian_food_portion_sizes (food_id, unit, size, grams)
select p.food_id, p.unit, s.size, greatest(5, round(p.grams * s.factor / 5) * 5)
  from public.nigerian_food_portions p
  cross join (values ('small', 0.6), ('medium', 1.0), ('large', 1.5)) as s(size, factor)
 where p.is_default
on conflict (food_id, unit, size) do nothing;

-- 3. The diary: provenance, offline idempotency, v5 food_logs view -------------------------------------------------------------------
alter table public.nutrition_log_entries
  add column if not exists client_id          uuid,
  add column if not exists client_recorded_at timestamptz,
  add column if not exists received_at        timestamptz,
  add column if not exists time_basis         text check (time_basis is null or time_basis in ('server', 'client_bounded')),
  add column if not exists source             public.record_source not null default 'patient',
  add column if not exists recorded_by        uuid references public.profiles (id) on delete restrict;

create unique index if not exists nutrition_log_entries_client_id_uidx
  on public.nutrition_log_entries (patient_id, client_id) where client_id is not null;

comment on column public.nutrition_log_entries.client_id is 'S49a: id minted on the phone so a retried offline send is a duplicate (23505), not a second meal (S06 pattern).';
comment on column public.nutrition_log_entries.recorded_by is 'S49a: null means the patient herself (S05 convention); set when staff or a supporter records the meal.';

create or replace function private.stamp_nutrition_entry_time()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_now timestamptz := clock_timestamp(); r record;
begin
  new.received_at := v_now;
  if new.client_recorded_at is not null then
    select * into r from private.resolve_offline_event_time(new.client_recorded_at, v_now);
    new.logged_at := r.effective_at;
    new.time_basis := r.basis;
  else
    new.time_basis := coalesce(new.time_basis, 'server');
  end if;
  return new;
end $$;
revoke all on function private.stamp_nutrition_entry_time() from public, anon, authenticated;
drop trigger if exists nutrition_log_entries_stamp_time on public.nutrition_log_entries;
create trigger nutrition_log_entries_stamp_time before insert on public.nutrition_log_entries
  for each row execute function private.stamp_nutrition_entry_time();

-- Provenance is set by the database, not claimed by the client: a row the patient writes for herself is always source 'patient' with no recorded_by;
-- a row written by anyone else carries that person's id. It cannot be changed afterwards.
create or replace function private.force_nutrition_provenance()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is not null and v_uid = new.patient_id then
    new.source := 'patient';
    new.recorded_by := null;
  elsif v_uid is not null then
    new.recorded_by := v_uid;
    if new.source = 'patient' then new.source := 'clinician'; end if;
  end if;
  return new;
end $$;
revoke all on function private.force_nutrition_provenance() from public, anon, authenticated;

create or replace function private.freeze_nutrition_provenance()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.source is distinct from old.source or new.recorded_by is distinct from old.recorded_by then
    raise exception 'source and recorded_by cannot be changed' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function private.freeze_nutrition_provenance() from public, anon, authenticated;

drop trigger if exists nutrition_log_entries_provenance on public.nutrition_log_entries;
create trigger nutrition_log_entries_provenance before insert on public.nutrition_log_entries
  for each row execute function private.force_nutrition_provenance();
drop trigger if exists nutrition_log_entries_freeze_provenance on public.nutrition_log_entries;
create trigger nutrition_log_entries_freeze_provenance before update on public.nutrition_log_entries
  for each row execute function private.freeze_nutrition_provenance();

-- v5 food_logs: a view, not a second store. photo_document_id is null by design (a meal photo is a storage path in the meal-photos bucket,
-- not a documents row); photo_path is exposed instead. energy_kcal is the food-database total when the meal was matched, else the photo estimate.
create or replace view public.food_logs with (security_invoker = true) as
select
  e.id,
  e.organisation_id,
  e.patient_id,
  e.meal_type::text as meal,
  coalesce(e.parsed_items, '[]'::jsonb) as items,
  e.photo_path,
  null::uuid as photo_document_id,
  case
    when jsonb_typeof(e.nutrition_analysis -> 'caloriesKcal') = 'number' then (e.nutrition_analysis ->> 'caloriesKcal')::numeric
    when jsonb_typeof(e.ai_estimate -> 'est_calories') = 'number' then (e.ai_estimate ->> 'est_calories')::numeric
  end as energy_kcal,
  case
    when jsonb_typeof(e.nutrition_analysis -> 'caloriesKcal') = 'number' then 'food_database'
    when jsonb_typeof(e.ai_estimate -> 'est_calories') = 'number' then 'photo_estimate'
  end as energy_basis,
  e.logged_at,
  e.client_id,
  e.source
from public.nutrition_log_entries e;
revoke all on public.food_logs from public, anon;
grant select on public.food_logs to authenticated;
comment on view public.food_logs is 'S49a: the v5 name for the diary. A view over nutrition_log_entries (security_invoker, so that table''s RLS decides); there is no second store.';

-- 4. food.logged event ---------------------------------------------------------------------------------------------------------------
insert into public.event_types (event_type, description, owner_section, is_urgent) values
  ('food.logged', 'A meal was added to the food diary', 'S49a', false)
on conflict (event_type) do nothing;
insert into public.event_type_versions (event_type, version, required_keys) values
  ('food.logged', 1, array['entry_id'])
on conflict (event_type, version) do nothing;

-- The payload carries the entry id only (INV-07: no food, no condition, no number). A bus failure must never lose the diary row, so it
-- is caught, written to the audit log (food.logged.emit_failed) and surfaced as a warning rather than raised.
create or replace function private.emit_food_logged()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  begin
    perform private.emit_domain_event('food.logged', new.organisation_id, jsonb_build_object('entry_id', new.id),
      'food.logged:' || new.id::text, new.patient_id, 'nutrition_log_entry', new.id);
  exception when others then
    raise warning 'food.logged event not emitted for %: %', new.id, sqlerrm;
    -- a durable trace too, so a systematic failure shows up in the audit log and not only in a server log
    begin
      perform private.log_audit('food.logged.emit_failed', 'nutrition_log_entries', new.id, jsonb_build_object('error', left(sqlerrm, 200)));
    exception when others then
      null; -- the diary row must still be saved
    end;
  end;
  return new;
end $$;
revoke all on function private.emit_food_logged() from public, anon, authenticated;
drop trigger if exists nutrition_log_entries_emit_food_logged on public.nutrition_log_entries;
create trigger nutrition_log_entries_emit_food_logged after insert on public.nutrition_log_entries
  for each row execute function private.emit_food_logged();

-- 5. Favourites, preferences, clinician hold -----------------------------------------------------------------------------------------
create table public.favourite_meals (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete restrict,
  patient_id       uuid not null references public.profiles (id) on delete cascade,
  name             text not null check (length(btrim(name)) between 1 and 60),
  meal_type        public.meal_type,
  description      text not null check (length(btrim(description)) between 1 and 500),
  use_count        integer not null default 0 check (use_count >= 0),
  last_used_at     timestamptz,
  client_id        uuid,
  source           public.record_source not null default 'patient',
  recorded_by      uuid references public.profiles (id) on delete restrict,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index favourite_meals_patient_idx on public.favourite_meals (patient_id, last_used_at desc nulls last);
create unique index favourite_meals_client_id_uidx on public.favourite_meals (patient_id, client_id) where client_id is not null;
create unique index favourite_meals_name_uidx on public.favourite_meals (patient_id, lower(btrim(name)));
create trigger favourite_meals_set_updated_at before update on public.favourite_meals for each row execute function private.set_updated_at();
create trigger favourite_meals_provenance before insert on public.favourite_meals for each row execute function private.force_nutrition_provenance();
create trigger favourite_meals_freeze_provenance before update on public.favourite_meals for each row execute function private.freeze_nutrition_provenance();
comment on table public.favourite_meals is 'S49a (6.3): a meal the patient saved by name to log again in one tap. Text only; nutrition is recomputed from the catalogue each time it is logged, never stored here. Patient-only (no staff policy).';
alter table public.favourite_meals enable row level security;
revoke all on public.favourite_meals from public, anon, authenticated;
grant select, insert, update, delete on public.favourite_meals to authenticated;
create policy favourite_meals_select on public.favourite_meals for select to authenticated using (patient_id = (select auth.uid()));
create policy favourite_meals_insert on public.favourite_meals for insert to authenticated
  with check (patient_id = (select auth.uid()) and organisation_id = private.current_org_id());
create policy favourite_meals_update on public.favourite_meals for update to authenticated
  using (patient_id = (select auth.uid())) with check (patient_id = (select auth.uid()) and organisation_id = private.current_org_id());
create policy favourite_meals_delete on public.favourite_meals for delete to authenticated using (patient_id = (select auth.uid()));

create table public.nutrition_preferences (
  patient_id        uuid primary key references public.profiles (id) on delete cascade,
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  meal_summary_mode text not null default 'numbers' check (meal_summary_mode in ('numbers', 'words')),
  updated_at        timestamptz not null default now()
);
create trigger nutrition_preferences_set_updated_at before update on public.nutrition_preferences for each row execute function private.set_updated_at();
comment on table public.nutrition_preferences is 'S49a (6.7): how the patient wants a meal summarised. words = a plain word (light, balanced, heavy) instead of numbers. Hidden by the same gate as targets.';
alter table public.nutrition_preferences enable row level security;
revoke all on public.nutrition_preferences from public, anon, authenticated;
grant select, insert, update on public.nutrition_preferences to authenticated;
create policy nutrition_preferences_select on public.nutrition_preferences for select to authenticated using (patient_id = (select auth.uid()));
create policy nutrition_preferences_insert on public.nutrition_preferences for insert to authenticated
  with check (patient_id = (select auth.uid()) and organisation_id = private.current_org_id());
create policy nutrition_preferences_update on public.nutrition_preferences for update to authenticated
  using (patient_id = (select auth.uid())) with check (patient_id = (select auth.uid()) and organisation_id = private.current_org_id());

-- A clinician's hold on nutrition targets for one patient. The patient has NO policy here and is never told the reason (or that a hold
-- exists): the gate answers only "not shown for you". Written only by set_nutrition_target_hold.
create table public.nutrition_target_holds (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete restrict,
  patient_id       uuid not null references public.profiles (id) on delete cascade,
  reason           text not null check (reason in ('clinician_flag', 'eating_disorder_concern', 'other_clinical')),
  set_by           uuid not null references public.profiles (id) on delete restrict,
  set_at           timestamptz not null default now(),
  cleared_at       timestamptz,
  cleared_by       uuid references public.profiles (id) on delete restrict,
  check ((cleared_at is null) = (cleared_by is null))
);
create unique index nutrition_target_holds_one_open_uidx on public.nutrition_target_holds (patient_id) where cleared_at is null;
comment on table public.nutrition_target_holds is 'S49a (6.5 safety): clinician hold that hides calorie and nutrient targets and the word summary for a patient. Staff read through a tie; the patient cannot read it.';
alter table public.nutrition_target_holds enable row level security;
revoke all on public.nutrition_target_holds from public, anon, authenticated;
grant select on public.nutrition_target_holds to authenticated;
create policy nutrition_target_holds_read on public.nutrition_target_holds for select to authenticated
  using (private.staff_may_read(patient_id, organisation_id, 'medical_history'::public.care_access_category));

create function public.set_nutrition_target_hold(p_patient uuid, p_hold boolean, p_reason text default 'clinician_flag')
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_org uuid; v_id uuid;
begin
  if v_uid is null then raise exception 'not authorised' using errcode = '42501'; end if;
  select organisation_id into v_org from public.profiles where id = p_patient;
  if v_org is null then raise exception 'patient not found' using errcode = 'P0002'; end if;
  -- a clinician (any tier, not a care coordinator) with a tie to this patient
  if not exists (select 1 from public.profiles pr join public.clinical_staff cs on cs.profile_id = pr.id
                  where pr.id = v_uid and pr.role = 'clinician' and pr.is_active and cs.active and pr.organisation_id = v_org)
     or not private.staff_may_write(p_patient, v_org, 'medical_history'::public.care_access_category) then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  if p_hold then
    if p_reason not in ('clinician_flag', 'eating_disorder_concern', 'other_clinical') then raise exception 'unknown hold reason' using errcode = '22023'; end if;
    insert into public.nutrition_target_holds (organisation_id, patient_id, reason, set_by)
    values (v_org, p_patient, p_reason, v_uid)
    on conflict (patient_id) where cleared_at is null do update set reason = excluded.reason
    returning id into v_id;
    perform private.log_audit('nutrition_target_hold.set', 'nutrition_target_holds', v_id, jsonb_build_object('patient_id', p_patient));
  else
    update public.nutrition_target_holds set cleared_at = now(), cleared_by = v_uid
     where patient_id = p_patient and cleared_at is null returning id into v_id;
    if v_id is not null then
      perform private.log_audit('nutrition_target_hold.cleared', 'nutrition_target_holds', v_id, jsonb_build_object('patient_id', p_patient));
    end if;
  end if;
  return v_id;
end $$;
revoke all on function public.set_nutrition_target_hold(uuid, boolean, text) from public, anon;
grant execute on function public.set_nutrition_target_hold(uuid, boolean, text) to authenticated;

-- 6. Governed targets configuration --------------------------------------------------------------------------------------------------
-- Mirrors parseNutritionTargetConfig (packages/shared/src/nutrition/targets.ts): a configuration the app would refuse must not be signable,
-- or every patient silently sees nothing. The app re-checks the same rules, so a config can never be half-valid in one place.
create function private.nutrition_target_config_valid(p_config jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare v_level text;
begin
  if not (p_config ? 'energy' and p_config ? 'macros_pct_of_energy' and p_config ? 'salt_sugar_fibre' and p_config ? 'meal_summary') then return false; end if;
  if coalesce((p_config #>> '{energy,floor_kcal,female}')::numeric, 0) < 1000 or coalesce((p_config #>> '{energy,floor_kcal,male}')::numeric, 0) < 1000 then return false; end if;
  if coalesce((p_config ->> 'min_age_years')::numeric, 0) < 18 then return false; end if;
  foreach v_level in array array['low', 'light', 'moderate', 'high'] loop
    if coalesce((p_config #>> array['energy', 'activity_factors', v_level])::numeric, 0) <= 0 then return false; end if;
  end loop;
  if (p_config #>> '{energy,default_activity}') is null or (p_config #>> '{energy,default_activity}') not in ('low', 'light', 'moderate', 'high') then return false; end if;
  if coalesce((p_config #>> '{energy,round_to_kcal}')::numeric, 0) <= 0 then return false; end if;
  if coalesce((p_config #>> '{energy,ceiling_kcal}')::numeric, 0) < greatest((p_config #>> '{energy,floor_kcal,female}')::numeric, (p_config #>> '{energy,floor_kcal,male}')::numeric) then return false; end if;
  if abs(coalesce((p_config #>> '{macros_pct_of_energy,carbs}')::numeric, 0) + coalesce((p_config #>> '{macros_pct_of_energy,protein}')::numeric, 0)
         + coalesce((p_config #>> '{macros_pct_of_energy,fat}')::numeric, 0) - 100) > 0.5 then return false; end if;
  if (p_config #>> '{salt_sugar_fibre,sodium_mg_max}') is null or (p_config #>> '{salt_sugar_fibre,sugar_pct_of_energy_max}') is null
     or (p_config #>> '{salt_sugar_fibre,fibre_g_per_1000_kcal}') is null then return false; end if;
  if (p_config #>> '{meal_summary,salty_above_sodium_mg}') is null or (p_config #>> '{meal_summary,sugary_above_sugar_g}') is null then return false; end if;
  if coalesce((p_config #>> '{meal_summary,light_below_kcal}')::numeric, 0) >= coalesce((p_config #>> '{meal_summary,heavy_above_kcal}')::numeric, 0) then return false; end if;
  return true;
exception when others then
  return false; -- a non-numeric value where a number belongs is simply not valid
end $$;
grant execute on function private.nutrition_target_config_valid(jsonb) to authenticated;

create table public.nutrition_target_config (
  id          uuid primary key default gen_random_uuid(),
  version     integer not null unique check (version >= 1),
  is_active   boolean not null default false,
  config      jsonb not null check (private.nutrition_target_config_valid(config)),
  notes       text,
  approved_by uuid references public.clinical_staff (id),
  approved_at timestamptz,
  created_at  timestamptz not null default now(),
  check ((approved_by is null) = (approved_at is null)),
  check (not is_active or approved_by is not null)
);
create unique index nutrition_target_config_one_active on public.nutrition_target_config (is_active) where is_active;
alter table public.nutrition_target_config enable row level security;
revoke all on public.nutrition_target_config from public, anon, authenticated;
grant select on public.nutrition_target_config to authenticated;
-- Not readable by a patient: she gets the numbers only through my_nutrition_target_gate(). Staff who sign it can read it.
create policy nutrition_target_config_read on public.nutrition_target_config for select to authenticated
  using (exists (select 1 from public.clinical_staff cs where cs.profile_id = (select auth.uid()) and cs.active)
         or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin'));
create trigger refuse_superseded_activation before update of is_active on public.nutrition_target_config
  for each row when (new.is_active and not old.is_active)
  execute function private.refuse_activating_superseded_version();

-- nutrition-target-config-begin
insert into public.nutrition_target_config (version, is_active, config, notes)
values (1, false, $json${
 "min_age_years": 18,
 "energy": {
  "activity_factors": {"low": 1.2, "light": 1.375, "moderate": 1.55, "high": 1.725},
  "default_activity": "light",
  "floor_kcal": {"female": 1200, "male": 1500},
  "ceiling_kcal": 3500,
  "round_to_kcal": 10
 },
 "macros_pct_of_energy": {"carbs": 50, "protein": 20, "fat": 30},
 "salt_sugar_fibre": {"sodium_mg_max": 2000, "sugar_pct_of_energy_max": 10, "fibre_g_per_1000_kcal": 14},
 "meal_summary": {"light_below_kcal": 400, "heavy_above_kcal": 750, "salty_above_sodium_mg": 800, "sugary_above_sugar_g": 25}
}$json$::jsonb,
        'PROPOSED, unsigned and INACTIVE. Maintenance estimates only (Mifflin-St Jeor), never a weight-loss target. Floors are the SAFE MINIMUMS: the plan never shows a calorie target below them. WHO anchors: salt under 5 g (2000 mg sodium), free sugars under 10 percent of energy. CMO to confirm every number, then sign_nutrition_target_config(). Until signed no patient sees any target or word summary.');
-- nutrition-target-config-end

create function public.sign_nutrition_target_config(p_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_staff uuid;
begin
  if not exists (select 1 from public.nutrition_target_config where id = p_id) then raise exception 'Nutrition target config version not found'; end if;
  select cs.id into v_staff from public.clinical_staff cs
   where cs.profile_id = (select auth.uid()) and cs.active and cs.status = 'active' and cs.doctor_tier = 'chief_medical_officer' limit 1;
  if v_staff is null then raise exception 'not authorised: only the active Chief Medical Officer can sign the nutrition target config'; end if;
  update public.nutrition_target_config set is_active = false where is_active and id <> p_id;
  update public.nutrition_target_config set approved_by = v_staff, approved_at = now(), is_active = true where id = p_id;
  perform private.log_audit('nutrition_target_config.signed', 'nutrition_target_config', p_id, '{}'::jsonb);
  return p_id;
end $$;
revoke all on function public.sign_nutrition_target_config(uuid) from public, anon;
grant execute on function public.sign_nutrition_target_config(uuid) to authenticated;

-- Whether targets (and the word summary) are withheld for this patient. Answers a boolean only, never a reason. Pregnancy is read here, on the
-- caller's OWN record, from the three places it is held (profiles, patient_pregnancy, reproductive life stage) plus the postnatal year;
-- there is no parameter a supporter or caregiver could use to read someone else's status, and no caregiver path is added. The function is
-- not executable by authenticated or anon.
create function private.nutrition_targets_withheld(p_patient uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select
    coalesce((select p.is_pregnant from public.profiles p where p.id = p_patient), false)
    or exists (select 1 from public.patient_pregnancy pp where pp.patient_id = p_patient and pp.is_pregnant)
    or exists (select 1 from public.reproductive_health_profiles rp where rp.patient_id = p_patient and rp.life_stage in ('pregnant', 'postpartum'))
    or exists (select 1 from public.postnatal_profiles np where np.patient_id = p_patient and np.delivery_date > (current_date - 365))
    or exists (select 1 from public.nutrition_target_holds h where h.patient_id = p_patient and h.cleared_at is null)
    or exists (select 1 from public.obesity_ed_screens e where e.patient_id = p_patient and e.positive)
    or coalesce((select p.date_of_birth > (current_date - interval '18 years') from public.profiles p where p.id = p_patient), false)
$$;
revoke all on function private.nutrition_targets_withheld(uuid) from public, anon, authenticated;

create function public.my_nutrition_target_gate() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_cfg public.nutrition_target_config%rowtype;
begin
  -- ONE answer for "withheld for you" and "not signed off yet", so that calling this function tells nobody which of the two it is.
  if v_uid is null then return jsonb_build_object('state', 'unavailable'); end if;
  if private.nutrition_targets_withheld(v_uid) then return jsonb_build_object('state', 'unavailable'); end if;
  select * into v_cfg from public.nutrition_target_config where is_active and approved_by is not null;
  if not found then return jsonb_build_object('state', 'unavailable'); end if;
  return jsonb_build_object('state', 'ok', 'config_version', v_cfg.version, 'config', v_cfg.config);
end $$;
revoke all on function public.my_nutrition_target_gate() from public, anon;
grant execute on function public.my_nutrition_target_gate() to authenticated;
comment on function public.my_nutrition_target_gate() is
  'S49a: the only way a patient receives nutrition targets. state unavailable (withheld for this person, or not signed off yet: the two are deliberately indistinguishable) or ok with the signed config.';

-- 7. Barcodes -----------------------------------------------------------------------------------------------------------------------
create function private.gtin_valid(p_code text) returns boolean
language plpgsql immutable set search_path = '' as $$
declare v_len integer; v_sum integer := 0; i integer; v_digit integer;
begin
  if p_code is null or p_code !~ '^[0-9]+$' then return false; end if;
  v_len := length(p_code);
  if v_len not in (8, 12, 13, 14) then return false; end if;
  for i in 1 .. v_len - 1 loop
    v_digit := substr(p_code, v_len - i, 1)::integer;
    v_sum := v_sum + v_digit * case when i % 2 = 1 then 3 else 1 end;
  end loop;
  return (10 - v_sum % 10) % 10 = substr(p_code, v_len, 1)::integer;
end $$;
revoke all on function private.gtin_valid(text) from public, anon;
grant execute on function private.gtin_valid(text) to authenticated;

create table public.barcodes (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique check (private.gtin_valid(code)),
  food_id       uuid not null references public.nigerian_foods (id) on delete restrict,
  product_name  text not null check (length(btrim(product_name)) > 0),
  brand         text,
  nafdac_number text check (nafdac_number is null or nafdac_number ~ '^[A-HJ-NP-Z]?[0-9]{1,2}-[0-9]{3,6}[A-HJ-NP-Z]?$'),
  pack_size_g   numeric(8, 1) check (pack_size_g is null or pack_size_g > 0),
  source        text not null default 'team_curated' check (source in ('team_curated')),
  curated_by    uuid references public.profiles (id) on delete restrict,
  created_at    timestamptz not null default now()
);
create index barcodes_food_idx on public.barcodes (food_id);
comment on table public.barcodes is 'S49a (6.4): Nigerian packaged foods entered by the Tarragon team, each pointing at a food row, with the NAFDAC number printed on the pack. Not an overseas open database. Global reference: admin write, authenticated read. No rows are seeded.';
alter table public.barcodes enable row level security;
revoke all on public.barcodes from public, anon, authenticated;
grant select, insert, update on public.barcodes to authenticated;
create policy barcodes_select on public.barcodes for select to authenticated using (true);
create policy barcodes_insert on public.barcodes for insert to authenticated with check (private.is_admin());
create policy barcodes_update on public.barcodes for update to authenticated using (private.is_admin()) with check (private.is_admin());

-- lookup by printed code; typing the code and scanning it use the same door
create function public.lookup_barcode(p_code text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_code text := regexp_replace(coalesce(p_code, ''), '\s', '', 'g'); b record;
begin
  if (select auth.uid()) is null then raise exception 'not authorised' using errcode = '42501'; end if;
  if not private.gtin_valid(v_code) then return jsonb_build_object('status', 'invalid'); end if;
  select bc.code, bc.product_name, bc.brand, bc.nafdac_number, bc.pack_size_g, f.code as food_code, f.name as food_name
    into b from public.barcodes bc join public.nigerian_foods f on f.id = bc.food_id where bc.code = v_code;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  return jsonb_build_object('status', 'found', 'code', b.code, 'product_name', b.product_name, 'brand', b.brand,
    'nafdac_number', b.nafdac_number, 'pack_size_g', b.pack_size_g, 'food_code', b.food_code, 'food_name', b.food_name);
end $$;
revoke all on function public.lookup_barcode(text) from public, anon;
grant execute on function public.lookup_barcode(text) to authenticated;

-- 8. Registrations: staff read scope, data registry, minor guard (an event trigger guards patient_id tables on creation) ---------------
insert into public.staff_read_scope (table_name, mode, patient_expr, category, reason) values
  ('nutrition_target_holds', 'tied', 'patient_id', 'medical_history', null)
on conflict (table_name) do nothing;
insert into public.data_registry (table_name, patient_expr, retention_class, end_of_retention, in_export, notes) values
  ('favourite_meals', 'patient_id', 'clinical_record', 'review', true, 'S49a. PROPOSED class, to be confirmed by the CMO and DPO.'),
  ('nutrition_preferences', 'patient_id', 'operational', 'delete', true, 'S49a. A display preference. PROPOSED class, to be confirmed by the CMO and DPO.'),
  ('nutrition_target_holds', 'patient_id', 'clinical_record', 'review', false, 'S49a. Clinician-only working flag, never patient-facing. Not exported to the patient: the DPO decides whether a subject-access request must include it.')
on conflict (table_name) do nothing;

-- 9. Self-checks ----------------------------------------------------------------------------------------------------------------------
do $$
declare v_foods integer; v_bad integer;
begin
  select count(*) into v_foods from public.nigerian_foods;
  if v_foods < 100 then raise exception 'S49a: expected at least 100 foods, found %', v_foods; end if;
  select count(*) into v_bad from public.nigerian_foods where data_quality <> 'estimated' or not needs_dietitian_review;
  if v_bad <> 0 then raise exception 'S49a: % foods are marked reviewed; none may be', v_bad; end if;
  select count(*) into v_bad from public.nigerian_foods f where not exists (select 1 from public.nigerian_food_portions p where p.food_id = f.id and p.is_default);
  if v_bad <> 0 then raise exception 'S49a: % foods have no default portion', v_bad; end if;
  if exists (select 1 from public.nigerian_food_portion_sizes where photo_path is not null) then raise exception 'S49a: no portion photo may exist yet'; end if;
  if (select count(*) from public.nutrition_target_config where is_active) <> 0 then raise exception 'S49a: the targets config must be born inactive'; end if;
  if (select count(*) from public.barcodes) <> 0 then raise exception 'S49a: no barcodes may be seeded'; end if;
  if (select private.nutrition_target_config_valid(config) from public.nutrition_target_config where version = 1) is not true then raise exception 'S49a: the seeded config fails its own validator'; end if;
  if has_function_privilege('anon', 'public.my_nutrition_target_gate()', 'EXECUTE') then raise exception 'S49a: anon can call the targets gate'; end if;
  if has_function_privilege('anon', 'public.lookup_barcode(text)', 'EXECUTE') then raise exception 'S49a: anon can look up barcodes'; end if;
  if has_function_privilege('anon', 'public.set_nutrition_target_hold(uuid, boolean, text)', 'EXECUTE') then raise exception 'S49a: anon can set a hold'; end if;
  if has_function_privilege('anon', 'public.sign_nutrition_target_config(uuid)', 'EXECUTE') then raise exception 'S49a: anon can sign'; end if;
  if has_function_privilege('authenticated', 'private.nutrition_targets_withheld(uuid)', 'EXECUTE') then raise exception 'S49a: a client can ask why targets are withheld'; end if;
  if has_table_privilege('anon', 'public.favourite_meals', 'SELECT') or has_table_privilege('anon', 'public.food_logs', 'SELECT') then raise exception 'S49a: anon can read a new table'; end if;
  if has_table_privilege('authenticated', 'public.nutrition_target_holds', 'INSERT') or has_table_privilege('authenticated', 'public.nutrition_target_holds', 'UPDATE') then
    raise exception 'S49a: a client can write holds directly';
  end if;
  if exists (select 1 from private.minor_guard_gaps()) then
    raise exception 'S49a: minor guard gaps: %', (select string_agg(table_name || ' (' || problem || ')', ', ') from private.minor_guard_gaps());
  end if;
end $$;
