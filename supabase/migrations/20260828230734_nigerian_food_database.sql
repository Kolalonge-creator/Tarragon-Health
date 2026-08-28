-- Nigerian Nutrition Intelligence — structured food database + portion system.
--
-- A real, queryable Nigerian food reference (spec 19.2/19.3), distinct from
-- the small `lib/nutrition/nigerian-foods.ts` cheat-sheet that only grounds
-- the meal-photo vision prompt (kept as-is — different job, different shape).
-- This table backs text-based food logging (spec 19.4), nutrition analysis
-- (19.5), condition-specific guidance (19.6) and the substitution engine
-- (19.7/19.9).
--
-- Global reference (no organisation_id), authenticated read-all, admin-only
-- write — same ownership shape as condition_protocols.
--
-- Honesty about data quality: per-100g macros here are estimated from
-- published composition data for common Nigerian home preparations, NOT a
-- laboratory-verified panel. `data_quality`/`source_note` say so explicitly
-- rather than presenting false precision — same "coaching guidance, never a
-- clinical measurement" convention as nutrition_log_entries.ai_estimate, and
-- the same "reference content pending professional review" honesty pattern
-- condition_protocols uses for its WHO-sourced content. A future dietitian
-- review updates `data_quality` to 'dietitian_reviewed' per row — a data
-- change, not a schema change.

do $$ begin
  create type public.nigerian_food_category as enum
    ('staple', 'swallow', 'legume', 'soup', 'protein', 'snack_drink');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.food_portion_unit as enum
    ('plate', 'cup', 'spoon', 'handful', 'piece', 'serving');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.food_cost_tier as enum ('budget', 'mid', 'premium');
exception when duplicate_object then null; end $$;

create table if not exists public.nigerian_foods (
  id                  uuid primary key default gen_random_uuid(),
  code                text not null unique,
  name                text not null,
  aliases             text[] not null default '{}',
  category            public.nigerian_food_category not null,
  cost_tier           public.food_cost_tier not null default 'mid',
  -- All macro columns are per 100g of the food as typically prepared/served
  -- (cooked weight for staples/swallows/soups, as-eaten for snacks/drinks) —
  -- not raw/dry weight, except where the food is itself dry (e.g. garri,
  -- biscuits, dry semolina).
  calories_kcal_100g  numeric(6, 1) not null check (calories_kcal_100g >= 0),
  carbs_g_100g        numeric(6, 1) not null check (carbs_g_100g >= 0),
  protein_g_100g      numeric(6, 1) not null check (protein_g_100g >= 0),
  fat_g_100g          numeric(6, 1) not null check (fat_g_100g >= 0),
  fibre_g_100g        numeric(6, 1) not null check (fibre_g_100g >= 0),
  sodium_mg_100g      numeric(7, 1) not null check (sodium_mg_100g >= 0),
  data_quality        text not null default 'estimated'
                        check (data_quality in ('estimated', 'dietitian_reviewed')),
  source_note         text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists nigerian_foods_category_idx on public.nigerian_foods (category);

drop trigger if exists nigerian_foods_set_updated_at on public.nigerian_foods;
create trigger nigerian_foods_set_updated_at
  before update on public.nigerian_foods
  for each row execute function private.set_updated_at();

alter table public.nigerian_foods enable row level security;

drop policy if exists nigerian_foods_select on public.nigerian_foods;
create policy nigerian_foods_select on public.nigerian_foods
  for select to authenticated
  using (true);

drop policy if exists nigerian_foods_insert on public.nigerian_foods;
create policy nigerian_foods_insert on public.nigerian_foods
  for insert to authenticated
  with check (private.is_admin());

drop policy if exists nigerian_foods_update on public.nigerian_foods;
create policy nigerian_foods_update on public.nigerian_foods
  for update to authenticated
  using (private.is_admin())
  with check (private.is_admin());

grant select, insert, update on public.nigerian_foods to authenticated;

-- --- Portion system (spec 19.3) ----------------------------------------------
-- A patient should never need a weighing scale. One row per (food, unit)
-- gives the gram-equivalent of "1 unit" of that specific food — a spoon of
-- soup and a spoon of rice are not the same weight, so this is deliberately
-- per-food, not a single global unit table. Not every food has every unit;
-- the app-layer falls back to a category-level default (see
-- lib/nutrition/portions.ts) when a specific (food, unit) row doesn't exist.
create table if not exists public.nigerian_food_portions (
  id          uuid primary key default gen_random_uuid(),
  food_id     uuid not null references public.nigerian_foods (id) on delete cascade,
  unit        public.food_portion_unit not null,
  grams       numeric(6, 1) not null check (grams > 0),
  is_default  boolean not null default false,
  unique (food_id, unit)
);

create index if not exists nigerian_food_portions_food_idx
  on public.nigerian_food_portions (food_id);

-- At most one default portion per food.
create unique index if not exists nigerian_food_portions_one_default_idx
  on public.nigerian_food_portions (food_id) where is_default;

alter table public.nigerian_food_portions enable row level security;

drop policy if exists nigerian_food_portions_select on public.nigerian_food_portions;
create policy nigerian_food_portions_select on public.nigerian_food_portions
  for select to authenticated
  using (true);

drop policy if exists nigerian_food_portions_insert on public.nigerian_food_portions;
create policy nigerian_food_portions_insert on public.nigerian_food_portions
  for insert to authenticated
  with check (private.is_admin());

drop policy if exists nigerian_food_portions_update on public.nigerian_food_portions;
create policy nigerian_food_portions_update on public.nigerian_food_portions
  for update to authenticated
  using (private.is_admin())
  with check (private.is_admin());

grant select, insert, update on public.nigerian_food_portions to authenticated;

-- --- seed: staples, swallows, legumes, soups, proteins, snacks & drinks ------
-- Estimates drawn from published Nigerian/West African food-composition
-- figures and common recipe analyses; genuine source-to-source variation
-- exists (preparation, oil quantity, cut of meat) — see the source_note on
-- each row. Coaching-guidance precision, not laboratory precision.
insert into public.nigerian_foods
  (code, name, aliases, category, cost_tier, calories_kcal_100g, carbs_g_100g, protein_g_100g, fat_g_100g, fibre_g_100g, sodium_mg_100g, source_note)
values
-- Staples
('white_rice', 'White rice (cooked)', array['rice'], 'staple', 'budget', 130, 28.2, 2.7, 0.3, 0.4, 1, 'Plain boiled white rice, no salt added.'),
('jollof_rice', 'Jollof rice', array['party rice'], 'staple', 'mid', 180, 27.0, 3.5, 6.0, 1.2, 320, 'Typical home preparation with oil, tomato/pepper base and seasoning cubes — sodium varies widely with seasoning used.'),
('fried_rice', 'Fried rice', array[]::text[], 'staple', 'mid', 175, 26.0, 3.8, 6.5, 1.3, 300, 'Typical party-style preparation with mixed vegetables and oil.'),
('yam_boiled', 'Boiled yam', array['iyan boiled', 'boiled white yam'], 'staple', 'budget', 118, 27.5, 1.5, 0.2, 4.1, 9, 'Water-boiled, no oil or salt added.'),
('plantain_boiled', 'Boiled plantain', array['boiled unripe plantain'], 'staple', 'budget', 122, 32.0, 1.3, 0.2, 2.3, 4, 'Unripe or semi-ripe plantain, boiled.'),
('plantain_fried', 'Fried plantain', array['dodo'], 'staple', 'budget', 200, 32.0, 1.5, 8.0, 2.3, 5, 'Ripe plantain, pan-fried in vegetable oil — fat content depends heavily on oil quantity/reuse.'),
('cassava_boiled', 'Boiled cassava', array[]::text[], 'staple', 'budget', 160, 38.0, 1.4, 0.3, 1.8, 14, 'Peeled and boiled.'),
('garri', 'Garri (dry, soaked)', array['gari'], 'staple', 'budget', 357, 86.9, 1.6, 0.7, 2.0, 15, 'Dry roasted cassava granules before soaking; wide brand-to-brand variation.'),
('maize_boiled', 'Boiled maize (corn)', array['corn on the cob', 'agbado'], 'staple', 'budget', 96, 21.0, 3.4, 1.5, 2.4, 15, 'Fresh maize, boiled.'),
('potato_boiled', 'Boiled Irish potato', array['irish potato'], 'staple', 'mid', 87, 20.1, 1.9, 0.1, 1.8, 6, 'Peeled and boiled, no salt added.'),
('semolina_dry', 'Semolina (dry)', array['farina'], 'staple', 'mid', 360, 73.0, 12.7, 1.0, 3.9, 1, 'Dry wheat semolina before preparation as a swallow.'),
-- Swallows (prepared, ready to eat)
('eba', 'Eba', array['garri swallow'], 'swallow', 'budget', 150, 36.0, 0.7, 0.3, 0.9, 6, 'Garri mixed with hot water to a swallow consistency.'),
('amala', 'Amala', array[]::text[], 'swallow', 'budget', 135, 31.0, 1.2, 0.3, 2.0, 5, 'Yam-flour (elubo) swallow.'),
('pounded_yam', 'Pounded yam', array['iyan'], 'swallow', 'budget', 130, 30.0, 1.6, 0.2, 2.0, 6, 'Freshly pounded yam swallow.'),
('fufu', 'Fufu', array['akpu'], 'swallow', 'budget', 155, 37.0, 0.8, 0.2, 1.1, 8, 'Fermented cassava swallow.'),
('semovita', 'Semovita', array['semo'], 'swallow', 'mid', 140, 30.0, 3.8, 0.4, 1.3, 4, 'Prepared semovita swallow.'),
-- Legumes
('beans_cooked', 'Beans (cooked)', array['ewa', 'cowpea', 'black-eyed peas'], 'legume', 'budget', 130, 22.0, 8.5, 0.7, 6.5, 4, 'Boiled with no added oil or salt.'),
('moi_moi', 'Moi moi', array['moin moin', 'moimoi', 'bean pudding'], 'legume', 'mid', 175, 14.0, 9.0, 9.0, 4.5, 250, 'Typical preparation with palm/vegetable oil, egg and a little fish — sodium/fat rise with richer fillings.'),
('akara', 'Akara', array['bean cake', 'acaraje'], 'legume', 'budget', 280, 18.0, 10.0, 18.0, 4.0, 260, 'Deep-fried bean fritter — fat is sensitive to oil absorption/frying time.'),
-- Soups (as served, excludes the swallow eaten with it)
('egusi_soup', 'Egusi soup', array[]::text[], 'soup', 'mid', 180, 4.0, 12.0, 13.0, 2.5, 420, 'Melon-seed soup with typical oil, meat/fish and stock-cube seasoning.'),
('okra_soup', 'Okra soup', array['okro soup'], 'soup', 'mid', 90, 6.0, 5.0, 5.5, 3.0, 380, 'Typical home preparation with palm oil and seasoning.'),
('vegetable_soup', 'Vegetable soup', array['efo riro'], 'soup', 'mid', 140, 5.0, 7.0, 10.0, 3.0, 400, 'Leafy-vegetable soup with typical oil and stock-cube seasoning.'),
('ewedu_soup', 'Ewedu soup', array[]::text[], 'soup', 'budget', 60, 5.0, 3.0, 3.0, 2.5, 250, 'Jute-leaf soup, lightly seasoned.'),
('afang_soup', 'Afang soup', array[]::text[], 'soup', 'mid', 165, 5.0, 9.0, 12.0, 3.5, 430, 'Afang-leaf soup with typical oil, meat/fish and stockfish.'),
('ogbono_soup', 'Ogbono soup', array[]::text[], 'soup', 'mid', 190, 6.0, 8.0, 15.0, 3.0, 400, 'Wild-mango-seed draw soup with typical oil and seasoning.'),
('pepper_soup', 'Pepper soup', array[]::text[], 'soup', 'mid', 70, 2.0, 9.0, 3.0, 0.5, 350, 'Light spiced broth (chicken/fish/goat) — sodium depends heavily on seasoning cubes used.'),
-- Proteins (cooked, without a heavy sauce)
('chicken_grilled', 'Grilled/roasted chicken', array['chicken'], 'protein', 'mid', 165, 0.0, 31.0, 3.6, 0.0, 75, 'Skinless, dry-cooked.'),
('beef_cooked', 'Cooked beef (lean)', array['beef'], 'protein', 'mid', 250, 0.0, 26.0, 15.0, 0.0, 65, 'Lean cut, stewed or grilled without added salt.'),
('fish_grilled', 'Grilled fish', array['fish', 'titus fish', 'mackerel'], 'protein', 'mid', 140, 0.0, 24.0, 4.5, 0.0, 80, 'Fresh fish, dry-grilled or pan-fried with minimal oil.'),
('fish_dried', 'Dried/stock fish', array['stockfish', 'dry fish', 'panla'], 'protein', 'premium', 290, 0.0, 62.0, 3.0, 0.0, 1200, 'Dried and salted for preservation — genuinely high in sodium; a key ingredient to watch for a low-salt pattern.'),
('eggs_boiled', 'Boiled eggs', array['egg', 'eggs'], 'protein', 'budget', 155, 1.1, 13.0, 11.0, 0.0, 124, 'Whole egg, boiled.'),
('goat_meat_cooked', 'Cooked goat meat', array['goat meat', 'goat'], 'protein', 'mid', 218, 0.0, 27.0, 11.0, 0.0, 82, 'Stewed or grilled, lean cut.'),
('shrimp_cooked', 'Cooked shrimp', array['prawns', 'seafood'], 'protein', 'premium', 99, 0.2, 24.0, 0.3, 0.0, 111, 'Boiled/steamed, no added salt.'),
('suya', 'Suya', array['spiced grilled meat'], 'protein', 'mid', 250, 4.0, 28.0, 13.0, 1.0, 480, 'Grilled meat with yaji spice mix and groundnut — sodium/fat rise with the spice quantity used.'),
-- Snacks and drinks
('meat_pie', 'Meat pie', array['pastries'], 'snack_drink', 'mid', 320, 30.0, 8.0, 19.0, 1.5, 420, 'Typical pastry with a minced-meat/potato filling.'),
('biscuits', 'Biscuits', array[]::text[], 'snack_drink', 'budget', 480, 68.0, 6.5, 20.0, 2.0, 380, 'Typical sweet tea biscuits.'),
('soft_drink', 'Soft drink', array['soda', 'fizzy drink', 'cola'], 'snack_drink', 'mid', 42, 10.6, 0.0, 0.0, 0.0, 5, 'Regular (non-diet) carbonated soft drink.'),
('malt_drink', 'Malt drink', array['malt'], 'snack_drink', 'mid', 46, 10.5, 0.5, 0.1, 0.0, 20, 'Non-alcoholic malt beverage.'),
('fruit_drink', 'Sweetened fruit drink', array['juice drink'], 'snack_drink', 'mid', 48, 12.0, 0.3, 0.0, 0.2, 8, 'Commercial sweetened fruit drink, not 100% juice.'),
('zobo', 'Zobo', array['hibiscus drink', 'sobolo'], 'snack_drink', 'budget', 35, 8.5, 0.2, 0.0, 0.1, 5, 'Home-made hibiscus drink, lightly sweetened — sugar content varies a lot by recipe.'),
('kunu', 'Kunu', array['kunun aya', 'millet drink'], 'snack_drink', 'budget', 55, 11.0, 1.3, 0.7, 0.4, 8, 'Home-made millet/guinea-corn drink — composition varies by recipe.')
on conflict (code) do nothing;

-- --- seed: portions -----------------------------------------------------------
insert into public.nigerian_food_portions (food_id, unit, grams, is_default)
select f.id, p.unit::public.food_portion_unit, p.grams, p.is_default
from (values
  ('white_rice', 'serving', 200, true), ('white_rice', 'cup', 150, false), ('white_rice', 'spoon', 30, false), ('white_rice', 'plate', 250, false),
  ('jollof_rice', 'serving', 200, true), ('jollof_rice', 'cup', 150, false), ('jollof_rice', 'spoon', 30, false), ('jollof_rice', 'plate', 250, false),
  ('fried_rice', 'serving', 200, true), ('fried_rice', 'spoon', 30, false), ('fried_rice', 'plate', 250, false),
  ('yam_boiled', 'serving', 200, true), ('yam_boiled', 'piece', 100, false), ('yam_boiled', 'plate', 250, false),
  ('plantain_boiled', 'serving', 150, true), ('plantain_boiled', 'piece', 100, false),
  ('plantain_fried', 'serving', 120, true), ('plantain_fried', 'piece', 40, false), ('plantain_fried', 'handful', 90, false),
  ('cassava_boiled', 'serving', 200, true), ('cassava_boiled', 'piece', 100, false),
  ('garri', 'serving', 50, true), ('garri', 'cup', 60, false), ('garri', 'spoon', 15, false),
  ('maize_boiled', 'piece', 90, true), ('maize_boiled', 'serving', 90, false),
  ('potato_boiled', 'serving', 150, true), ('potato_boiled', 'piece', 60, false),
  ('semolina_dry', 'serving', 60, true), ('semolina_dry', 'cup', 60, false), ('semolina_dry', 'spoon', 15, false),
  ('eba', 'serving', 200, true), ('eba', 'piece', 200, false), ('eba', 'plate', 250, false),
  ('amala', 'serving', 200, true), ('amala', 'piece', 200, false), ('amala', 'plate', 250, false),
  ('pounded_yam', 'serving', 200, true), ('pounded_yam', 'piece', 200, false), ('pounded_yam', 'plate', 250, false),
  ('fufu', 'serving', 200, true), ('fufu', 'piece', 200, false), ('fufu', 'plate', 250, false),
  ('semovita', 'serving', 200, true), ('semovita', 'piece', 200, false), ('semovita', 'plate', 250, false),
  ('beans_cooked', 'serving', 150, true), ('beans_cooked', 'cup', 120, false), ('beans_cooked', 'spoon', 25, false), ('beans_cooked', 'plate', 200, false),
  ('moi_moi', 'piece', 120, true), ('moi_moi', 'serving', 150, false),
  ('akara', 'piece', 25, true), ('akara', 'handful', 75, false), ('akara', 'serving', 100, false),
  ('egusi_soup', 'serving', 300, true), ('egusi_soup', 'cup', 200, false), ('egusi_soup', 'spoon', 20, false),
  ('okra_soup', 'serving', 300, true), ('okra_soup', 'cup', 200, false), ('okra_soup', 'spoon', 20, false),
  ('vegetable_soup', 'serving', 300, true), ('vegetable_soup', 'cup', 200, false), ('vegetable_soup', 'spoon', 20, false),
  ('ewedu_soup', 'serving', 250, true), ('ewedu_soup', 'cup', 180, false), ('ewedu_soup', 'spoon', 20, false),
  ('afang_soup', 'serving', 300, true), ('afang_soup', 'cup', 200, false), ('afang_soup', 'spoon', 20, false),
  ('ogbono_soup', 'serving', 300, true), ('ogbono_soup', 'cup', 200, false), ('ogbono_soup', 'spoon', 20, false),
  ('pepper_soup', 'serving', 300, true), ('pepper_soup', 'cup', 220, false),
  ('chicken_grilled', 'piece', 90, true), ('chicken_grilled', 'serving', 100, false), ('chicken_grilled', 'handful', 60, false),
  ('beef_cooked', 'piece', 80, true), ('beef_cooked', 'serving', 100, false), ('beef_cooked', 'handful', 60, false),
  ('fish_grilled', 'piece', 90, true), ('fish_grilled', 'serving', 100, false),
  ('fish_dried', 'piece', 30, true), ('fish_dried', 'serving', 40, false),
  ('eggs_boiled', 'piece', 50, true), ('eggs_boiled', 'serving', 100, false),
  ('goat_meat_cooked', 'piece', 80, true), ('goat_meat_cooked', 'serving', 100, false), ('goat_meat_cooked', 'handful', 60, false),
  ('shrimp_cooked', 'handful', 40, true), ('shrimp_cooked', 'serving', 100, false),
  ('suya', 'serving', 100, true), ('suya', 'handful', 60, false), ('suya', 'piece', 20, false),
  ('meat_pie', 'piece', 90, true), ('meat_pie', 'serving', 90, false),
  ('biscuits', 'piece', 8, true), ('biscuits', 'handful', 40, false), ('biscuits', 'serving', 50, false),
  ('soft_drink', 'cup', 250, true), ('soft_drink', 'serving', 350, false),
  ('malt_drink', 'cup', 250, true), ('malt_drink', 'serving', 330, false),
  ('fruit_drink', 'cup', 250, true), ('fruit_drink', 'serving', 300, false),
  ('zobo', 'cup', 250, true), ('zobo', 'serving', 350, false),
  ('kunu', 'cup', 250, true), ('kunu', 'serving', 350, false)
) as p(code, unit, grams, is_default)
join public.nigerian_foods f on f.code = p.code
on conflict (food_id, unit) do nothing;

-- Assertion: prove the catalogue actually landed with every category present
-- and every food has at least a default portion.
do $$
declare
  v_foods integer;
  v_categories integer;
  v_missing_default integer;
begin
  select count(*) into v_foods from public.nigerian_foods;
  select count(distinct category) into v_categories from public.nigerian_foods;
  select count(*) into v_missing_default
    from public.nigerian_foods f
    where not exists (
      select 1 from public.nigerian_food_portions p
      where p.food_id = f.id and p.is_default
    );

  if v_foods < 40 then
    raise exception 'expected at least 40 seeded nigerian_foods rows, found %', v_foods;
  end if;
  if v_categories < 6 then
    raise exception 'expected all 6 nigerian_food_category values represented, found %', v_categories;
  end if;
  if v_missing_default > 0 then
    raise exception '% nigerian_foods rows have no default portion', v_missing_default;
  end if;
end $$;
