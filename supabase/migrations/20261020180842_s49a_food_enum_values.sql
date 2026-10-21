-- S49a (part 1 of 2): enum values the Nigerian food catalogue needs. Kept in its own file because a newly added enum value cannot
-- be used in the same transaction that adds it; the next migration (s49a_food_logging_foundation) seeds rows that use them.
--   food_portion_unit: wrap (a wrap of eba or amala), ladle (a ladle of soup or pap), bowl (a bowl of soup or porridge).
--   nigerian_food_category: fruit_veg (fruit and fresh vegetables were missing, and they are among the most eaten foods).
-- LIVE COUNT BEFORE: nigerian_foods 41 rows, nigerian_food_portions 0 rows using any new value, nutrition_log_entries 1 row.
alter type public.food_portion_unit add value if not exists 'wrap';
alter type public.food_portion_unit add value if not exists 'ladle';
alter type public.food_portion_unit add value if not exists 'bowl';
alter type public.nigerian_food_category add value if not exists 'fruit_veg';
